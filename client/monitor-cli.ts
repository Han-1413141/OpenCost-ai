import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { collectionWindow, rangeDays, largeRangeNotice } from '../shared/collection.js';
import { SubscriptionEnvelopeSchema, SubscriptionSnapshotSchema } from '../shared/subscriptions.js';
import { createSQLiteSnapshot } from '../shared/sqlite-backup.js';
import { StorageBudgetError } from '../shared/sqlite-storage-budget.js';
import { readMonitorConfig } from './monitor-config.js';
import { readMonitorStorageOptions } from './monitor-storage-options.js';
import { MonitorStore, type MonitorGrant, type SourceState } from './monitor-store.js';
import { MonitorRuntimeError, runMonitorRuntime } from './monitor-runtime.js';
import { requestMonitorStop } from './monitor-stop.js';
import { newMonitorDiagnosticRun, readMonitorDiagnostics } from './monitor-diagnostics.js';
import { grantMonitorAuthorization, revokeMonitorAuthorization } from './monitor-authorization.js';
import { readLocalTextSync } from './local-file.js';
import { contributorId, createAccessKey, defaultAccessKeyPath, endpointOrigin } from './sdk.js';
import {
  subscriptionTemplate,
  prepareSubscriptions,
  subscriptionEnvelope,
  submitSubscriptions,
  listSubscriptions,
  type SubscriptionDraft,
} from './subscriptions.js';

const args = process.argv.slice(2),
  command = args.shift();
const arg = (flag: string, fallback?: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`缺少 ${flag} 的值`);
  return args[i + 1];
};
const required = (flag: string) => {
  const value = arg(flag);
  if (!value) throw new Error(`请提供 ${flag}`);
  return value;
};
const save = (file: string, value: unknown) => {
  file = resolve(file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
};
const key = (create = false, endpoint = arg('--endpoint')) => {
  const explicitPath = arg('--identity');
  if (!explicitPath && !endpoint) throw new Error('默认访问密钥需要目标站点 Origin');
  const file = explicitPath ? resolve(explicitPath) : defaultAccessKeyPath(endpoint!);
  if (create && !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, createAccessKey(), { flag: 'wx', mode: 0o600 });
  }
  if (!existsSync(file))
    throw new Error('该站点尚无访问密钥；旧身份使用 --identity 指向原密钥，或先 grant 配置新身份');
  const value = readLocalTextSync(file, 1024).trim();
  contributorId(value);
  return value;
};
let diagnosticRun: ReturnType<typeof newMonitorDiagnosticRun> | undefined;
let runStage: 'storage_unavailable' | 'configuration_invalid' | 'runtime_failed' =
  'storage_unavailable';
try {
  const file = command === 'storage-options' ? '' : resolve(arg('--db', '.local/monitor.sqlite')!);
  if (command === 'run') {
    diagnosticRun = newMonitorDiagnosticRun(file);
    diagnosticRun.record('start', 'starting');
  }
  if (command === 'collect-template') {
    const { quotaCollectionTemplate } = await import('./quota-collection.js');
    save(required('--out'), quotaCollectionTemplate());
  } else if (command === 'collect') {
    const { collectQuotaOnce } = await import('./quota-collection.js');
    const enabled = args.includes('--enabled');
    // Disabled execution does not inspect config, output or history paths.
    if (!enabled) console.log(JSON.stringify(await collectQuotaOnce({ enabled: false })));
    else {
      const endAt = arg('--through', new Date().toISOString())!,
        range = arg('--range', '3d')!,
        since = arg('--since');
      if ((since && args.includes('--range')) || (!since && !(range in rangeDays)))
        throw new Error('使用 --range 1d/3d/7d/30d/90d 或 --since ISO，不能同时选择。');
      const report = await collectQuotaOnce({
        enabled,
        configPath: required('--config'),
        out: required('--out'),
        interval: {
          startAt:
            since ?? collectionWindow(range as keyof typeof rangeDays, new Date(endAt)).startAt,
          endAt,
        },
        statistics: args.includes('--share-quota-statistics'),
      });
      console.log(JSON.stringify(report, null, 2));
      if (!['ready', 'empty'].includes(report.status)) process.exitCode = 1;
    }
  } else if (command === 'diagnostics') {
    console.log(JSON.stringify(readMonitorDiagnostics(file), null, 2));
  } else if (command === 'storage-options') {
    // Pure validation for launchers: do not resolve monitor paths or open state.
    const env = { ...process.env };
    const fields = new Map([
      ['--max-bytes', 'OPENCOST_MONITOR_MAX_BYTES'],
      ['--reserve-bytes', 'OPENCOST_MONITOR_RESERVE_BYTES'],
      ['--wal-max-bytes', 'OPENCOST_MONITOR_WAL_MAX_BYTES'],
      ['--disk-reserve-bytes', 'OPENCOST_MONITOR_DISK_RESERVE_BYTES'],
    ]);
    const seen = new Set<string>();
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i],
        field = fields.get(flag),
        value = args[i + 1];
      if (!field || seen.has(flag) || value === undefined || value.startsWith('--'))
        throw new Error('Invalid storage option');
      seen.add(flag);
      env[field] = value;
    }
    console.log(JSON.stringify(readMonitorStorageOptions(env), null, 2));
  } else if (command === 'backup' || command === 'restore') {
    // Do not open a MonitorStore here: a snapshot must not migrate the source,
    // initialize a salt, change old authorization, or start background work.
    const source = resolve(required(command === 'backup' ? '--db' : '--input'));
    const result = await createSQLiteSnapshot(source, resolve(required('--out')));
    console.log(
      JSON.stringify(
        {
          format: 'opencost-monitor-backup-1',
          operation: command,
          source,
          ...result,
          authorization: 'preserved',
          started: false,
          includes: ['本机订阅历史', '授权与来源状态', '待传批次', '上传回执', '审计历史'],
          excludes: [
            '外部 API 环境密钥',
            '独立身份文件',
            '监控配置文件',
            '导出目录',
            'collection-state',
            '本地运行诊断旁文件',
          ],
          notice:
            '这是包含本机历史、授权和待传内容的完整数据库副本，请按私密文件保管。原库与已有备份保留，未启动监控或安装任务。恢复副本保留旧自动授权；启动前先用 monitor off --db <恢复文件> 关闭旧授权，检查来源、身份、目标及外部文件，再重新授权运行。',
        },
        null,
        2,
      ),
    );
  } else if (command === 'export-observations') {
    const out = resolve(required('--out')),
      observationsOut = arg('--observations-out');
    if (
      existsSync(out) ||
      (observationsOut &&
        (existsSync(resolve(observationsOut)) ||
          resolve(observationsOut).toLowerCase() === out.toLowerCase()))
    )
      throw new Error('请使用不同的新输出文件，保留原始历史和已有导出。');
    const { exportMonitorHistory } = await import('./monitor-history-export.js');
    const enabled = args.includes('--enabled');
    let request;
    if (enabled) {
      const endAt = arg('--through', new Date().toISOString())!;
      const since = arg('--since'),
        range = arg('--range', '3d')!;
      if ((since && args.includes('--range')) || (!since && !(range in rangeDays)))
        throw new Error(
          '请使用 --since/--through，或 --range 1d、3d、7d、30d、90d，不能同时选择。',
        );
      const startAt =
        since ?? collectionWindow(range as keyof typeof rangeDays, new Date(endAt)).startAt;
      const mappingFile = arg('--mapping');
      request = {
        file,
        subscriptionRef: required('--subscription-ref'),
        startAt,
        endAt,
        ...(mappingFile
          ? { mapping: JSON.parse(readLocalTextSync(resolve(mappingFile), 2 * 1024 * 1024)) }
          : {}),
      };
    }
    const report = exportMonitorHistory(request, { enabled });
    save(out, report);
    if (observationsOut && report.status === 'complete' && report.input)
      save(observationsOut, report.input);
    console.log(
      `本地历史导出：${report.status}；观察${report.counts.matchedRowsIsLowerBound ? '至少' : ''} ${report.counts.matchedRows} 份。报告可直接放入本地额度面板；无映射时保留缺口。未启动监控、推进上传进度或调用模型。`,
    );
    if (!['disabled', 'complete', 'empty'].includes(report.status)) process.exitCode = 1;
  } else if (command === 'init') {
    save(required('--out'), {
      format: 'opencost-monitor-1',
      sources: [],
      workOutbox: null,
      collectionState: 'collection-state.json',
    });
    console.log(
      '已生成关闭状态的配置。先选择额度来源，或指定已脱敏的工作预览目录；grant 只保存授权，run/启动脚本才会运行。',
    );
  } else if (command === 'template') save(required('--out'), subscriptionTemplate());
  else if (command === 'schema') {
    if (arg('--format') === 'quota-collection') {
      const { QuotaCollectionConfigSchema } = await import('./quota-collection.js');
      save(
        required('--out'),
        z.toJSONSchema(QuotaCollectionConfigSchema, { unrepresentable: 'any' }),
      );
    } else if (arg('--format') === 'history-export') {
      const { MonitorHistoryExportSchema } =
        await import('../shared/monitor-history-export-schema.js');
      save(
        required('--out'),
        z.toJSONSchema(MonitorHistoryExportSchema, { unrepresentable: 'any' }),
      );
    } else
      save(
        required('--out'),
        z.toJSONSchema(
          arg('--format') === 'snapshot' ? SubscriptionSnapshotSchema : SubscriptionEnvelopeSchema,
          { unrepresentable: 'any' },
        ),
      );
  } else if (command === 'prepare') {
    const snapshots = JSON.parse(readLocalTextSync(resolve(required('--input')), 4 * 1024 * 1024));
    save(
      required('--out'),
      prepareSubscriptions(
        subscriptionEnvelope(
          Array.isArray(snapshots) ? snapshots : [snapshots],
          process.argv.includes('--share-quota-statistics'),
        ),
      ),
    );
  } else if (command === 'submit') {
    const draft = JSON.parse(
      readLocalTextSync(resolve(required('--input')), 4 * 1024 * 1024),
    ) as SubscriptionDraft;
    console.log(
      JSON.stringify(
        await submitSubscriptions(
          required('--endpoint'),
          key(),
          draft,
          required('--confirm-digest'),
        ),
      ),
    );
  } else if (command === 'mine')
    console.log(
      JSON.stringify(
        await listSubscriptions(required('--endpoint'), key(), {
          ...(arg('--limit') !== undefined ? { limit: Number(arg('--limit')) } : {}),
          ...(arg('--before-sequence') !== undefined
            ? { beforeSequence: Number(arg('--before-sequence')) }
            : {}),
          ...(arg('--subscription-ref') !== undefined
            ? { subscriptionRef: arg('--subscription-ref')! }
            : {}),
        }),
        null,
        2,
      ),
    );
  else if (command === 'stop') {
    requestMonitorStop(file);
    console.log(
      '已请求停止：活动期间约 2 秒内取消，空闲最长 60 秒内处理；等待当前操作实际结束后退出，不会删除任何历史。',
    );
  } else if (['grant', 'run', 'status', 'off', 'verify'].includes(command ?? '')) {
    const store = new MonitorStore(file, readMonitorStorageOptions());
    try {
      if (command === 'off') {
        revokeMonitorAuthorization(store);
        console.log('监控及自动上传已关闭；原快照和待重试批次保留。');
      } else if (command === 'verify') console.log(JSON.stringify(store.verify(), null, 2));
      else if (command === 'status') {
        const grant = store.get<MonitorGrant>('grant');
        const sources = grant
          ? (
              store.db
                .prepare('SELECT key,payload FROM settings WHERE key LIKE ?')
                .all(`source:${grant.configDigest}:%`) as { key: string; payload: string }[]
            ).map((row) => {
              const state = JSON.parse(row.payload) as SourceState;
              return {
                id: row.key.split(':').at(-1),
                nextAt: state.nextAt,
                failures: state.failures,
                lastGood: state.lastGood ?? null,
                resetAt: state.resetAt ?? null,
              };
            })
          : [];
        console.log(
          JSON.stringify(
            {
              grant,
              uploadRetry: grant?.uploadFailure ?? null,
              attention: store.get('attention'),
              rangeNotice: store.get('rangeNotice'),
              runningLease: store.get('running'),
              diagnostics: readMonitorDiagnostics(file),
              sources,
              changes: store.changes(),
              counts: store.db
                .prepare(
                  'SELECT (SELECT count(*) FROM observations) observations,(SELECT count(*) FROM bodies) distinctBodies,(SELECT count(*) FROM audit) historyEntries',
                )
                .get(),
              databaseBytes: (await import('node:fs')).statSync(file).size,
              storage: store.storageBudget.snapshot(),
            },
            null,
            2,
          ),
        );
      } else {
        runStage = 'configuration_invalid';
        const configFile = resolve(required('--config')),
          { config, digest } = readMonitorConfig(configFile);
        if (command === 'grant') {
          const mode = required('--mode');
          if (!['local', 'upload'].includes(mode))
            throw new Error('--mode 只接受 local 或 upload；关闭使用 off');
          if (!config.sources.length && !config.workOutbox)
            throw new Error('先选择至少一个实际来源或工作预览目录');
          const incremental = arg('--incremental');
          if (mode === 'upload' && !['on', 'off'].includes(incremental ?? ''))
            throw new Error('自动上传前请用户选择 --incremental on/off，并说明超过 3 天需要重选');
          const range = arg('--range', mode === 'local' ? '3d' : undefined);
          if (!range || !Object.hasOwn(rangeDays, range))
            throw new Error('请先选择 --range 1d/3d/7d/30d/90d，推荐近 3 天');
          const window = collectionWindow(range as keyof typeof rangeDays);
          if (rangeDays[range as keyof typeof rangeDays] > 3) console.log(largeRangeNotice);
          const endpoint = mode === 'upload' ? endpointOrigin(required('--endpoint')) : null;
          const contributor = mode === 'upload' ? contributorId(key(true)) : null;
          grantMonitorAuthorization(store, {
            mode: mode as 'local' | 'upload',
            incrementalEnabled: incremental === 'on',
            configDigest: digest,
            sourceIds: config.sources.map((source) => source.id),
            endpoint,
            contributor,
            window,
          });
          console.log(
            `已保存 ${mode === 'local' ? '仅本地记录' : '每日自动上传'} 授权。来源 ${config.sources.length} 个，单次读取最多 1 MiB，串行执行，失败退避。订阅数据仅本人可见、Q0 自报；不调用大模型。尚未启动后台进程。`,
          );
        } else {
          runStage = 'runtime_failed';
          const outcome = await runMonitorRuntime({
            store,
            file,
            configFile,
            config,
            digest,
            once: args.includes('--once'),
            runId: diagnosticRun?.runId,
            onReady: () => {
              diagnosticRun?.record('ready', 'ready');
            },
            key: (grant) => {
              if (grant.mode !== 'upload') return undefined;
              const accessKey = key(false, grant.endpoint ?? undefined);
              if (contributorId(accessKey) !== grant.contributor)
                throw new MonitorRuntimeError('credentials_unavailable');
              return accessKey;
            },
          });
          diagnosticRun?.record('finished', outcome.code);
          if (outcome.code === 'not_authorized') {
            console.error('监控未启动：尚未授权或授权已关闭，请先选择来源与运行方式。');
            process.exitCode = 1;
          }
        }
      }
    } finally {
      store.close();
    }
  } else
    console.log(
      'OpenCost-AI 低开销监控：init / collect-template / collect / template / schema / prepare / submit / mine / grant / run [--once] / status / diagnostics / stop / off / verify / backup / restore / export-observations / storage-options。默认关闭。\ncollect-template --out NEW.json；collect --config FILE --out NEW_DIRECTORY --range 3d --enabled：单次读取选定历史和当前额度，输出覆盖报告与分批预览，不开后台、不上传。\nexport-observations --db FILE --subscription-ref UUID --out NEW.json [--range 3d|1d|7d|30d|90d] [--since ISO --through ISO] [--mapping FILE] [--observations-out NEW.json] --enabled；只读导出，默认近3天，最长90天，最多1024份观察/2 MiB；报告可直接导入本地额度面板。\ndiagnostics --db FILE 只读本地运行诊断，不打开数据库；进程存在不代表监控仍在运行。\nstorage-options [--max-bytes N] [--reserve-bytes N] [--wal-max-bytes N] [--disk-reserve-bytes N] 只校验和输出存储预算，不访问数据库。\nbackup --db FILE --out NEW_FILE；restore --input BACKUP --out NEW_FILE。仅复制数据库到新路径，不覆盖、不启动；副本保留原授权，启动前先用 off 关闭旧授权并重新检查。\nmine --endpoint ORIGIN [--limit 100] [--before-sequence NEXT_SEQUENCE] [--subscription-ref UUID] 每次读取一页；nextBeforeSequence 非空时继续传给 --before-sequence。完整说明见 docs/monitoring.md。',
    );
} catch (error) {
  diagnosticRun?.record(
    'finished',
    error instanceof StorageBudgetError
      ? error.reason === 'database'
        ? 'storage_database'
        : error.reason === 'wal'
          ? 'storage_wal'
          : 'storage_disk'
      : error instanceof MonitorRuntimeError
        ? error.code
        : runStage,
  );
  // Do not echo source response/schema values, credentials, URLs or filesystem paths.
  console.error(
    command === 'storage-options'
      ? '监控存储预算参数无效；请使用十进制整数，并确保恢复保留空间小于数据库容量。'
      : error instanceof StorageBudgetError
        ? `[STORAGE_BUDGET_EXCEEDED:${error.reason}] ${
            error.reason === 'wal'
              ? '监控写入日志达到容量上限；历史保留，请释放占用或调整日志预算后重试。'
              : error.reason === 'disk'
                ? '监控磁盘可用空间不足；历史保留，请释放磁盘空间后重试。'
                : '监控数据库达到容量上限；历史保留，请备份并增加存储预算后重试。'
          }`
        : error instanceof MonitorRuntimeError
          ? error.message
          : error instanceof z.ZodError
            ? '监控结构校验失败；请按 schema 核对字段，原始数据未上传。'
            : error instanceof SyntaxError
              ? '监控 JSON 文件无法解析；请检查本地输入格式，原始内容未输出。'
              : error instanceof Error && !('cause' in error) && !('code' in error)
                ? error.message
                : '监控操作未完成，请检查本地文件、权限或网络。',
  );
  process.exitCode = 1;
}
