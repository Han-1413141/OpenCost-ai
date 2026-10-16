import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { connectAccount, accountConnection } from './account.js';
import { checkServer } from './server-capabilities.js';
import { codeObservationNotice } from '../shared/code-observation-counts.js';
import { dirname, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ZodError } from 'zod';
import { AttestationSchema, EnvelopeSchema, canonical, workSummary } from '../shared/schema.js';
import { compileCapture, CapturePacketSchema } from './capture.js';
import { captureTemplate } from './template.js';
import { manualSummaryTemplate, compileManualSummary, prepareJournal, ManualSummaryFactsSchema } from './manual-summary.js';
import { uploadWorkJournal } from './work-journal.js';
import { reconcileCharges } from './charge-coverage.js';
import { calibrateDifficulty } from '../shared/difficulty-calibration.js';
import { computeTaskComplexity, taskComplexityLimits } from '../shared/task-complexity.js';
import {
  createComplexityReviewPacket,
  validateComplexityReview,
  COMPLEXITY_REVIEW_MAX_BYTES,
} from '../shared/complexity-review.js';
import { importDsh, inspectDsh, dshSubscriptionSnapshots } from './dsh.js';
import {
  collectionWindow,
  describeWindow,
  largeRangeNotice,
  rangeDays,
  rangeLabels,
  type CollectionRange,
} from '../shared/collection.js';
import {
  assertAutomaticRun,
  assertAutomaticUpload,
  nextCollection,
  readSession,
  recordSuccessfulUpload,
  updateSession,
  type CollectionSession,
} from './session.js';
import { readSource, sourceIntroduction } from './source.js';
import { reservedSessionPaths, sessionStorageErrorMessage } from './session-storage.js';
import { readLocalTextSync } from './local-file.js';
import {
  exportReceiptDocument,
  saveReceiptCredential,
  saveReceiptHistory,
} from './receipt-file.js';
import { renderFeedbackText } from '../shared/personal-feedback.js';
import {
  createAccessKey,
  contributorId,
  defaultAccessKeyPath,
  endpointOrigin,
  listRecords,
  prepareDraft,
  submitDraft,
  HttpRequestError,
  type PreparedDraft,
} from './sdk.js';

const args = process.argv.slice(2),
  command = args.shift();
const arg = (flag: string, fallback?: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  const next = args[i + 1];
  if (!next || next.startsWith('--')) throw new Error(`缺少 ${flag} 的值`);
  return next;
};
const required = (flag: string) => {
  const value = arg(flag);
  if (!value) throw new Error(`请提供 ${flag}`);
  return value;
};
const readJson = (path: string, maximumBytes = 512 * 1024) => {
  const contents = readLocalTextSync(resolve(path), maximumBytes);
  try {
    return JSON.parse(contents);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error('JSON 文件无法解析；请检查本地输入格式，原始内容未输出。');
    throw error;
  }
};
const safeErrorMessage = (error: unknown) => {
  const storageMessage = sessionStorageErrorMessage(error);
  if (storageMessage) return storageMessage;
  if (error instanceof HttpRequestError)
    if (error.code === 'UPLOAD_SCHEMA_INVALID')
      return '站点拒收记录格式。先运行 check-server 核对当前接口，再按站点 schema 修正字段；保留原预览，未知金额不要填零。';
  if (error instanceof HttpRequestError)
    return `站点请求失败（HTTP ${error.status}）；请保留原预览和幂等键，核对站点状态后重试。`;
  if (error instanceof ZodError) return '结构校验失败；请按 schema 核对本地字段，原始内容未输出。';
  if (error instanceof SyntaxError)
    return 'JSON 文件无法解析；请检查本地输入格式，原始内容未输出。';
  if (
    error instanceof Error &&
    error.constructor === Error &&
    !('cause' in error) &&
    !('code' in error)
  ) {
    const status = /^([1-5][0-9]{2}):(?:\s|$)/.exec(error.message);
    if (status)
      return `站点请求失败（HTTP ${status[1]}）；请保留原预览和幂等键，核对站点状态后重试。`;
    return error.message;
  }
  return '操作未完成，请检查本地文件、权限或网络；路径与远端详情未输出。';
};
const saveJson = (path: string, value: unknown) => {
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
};
const saveNewResearchJson = (path: string, value: unknown) => {
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  // Exclusive creation also handles another process creating the path after our check.
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
};
const identity = (endpoint = arg('--endpoint'), createMissing = true) => {
  const credentialPath = arg('--credential');
  if (credentialPath) {
    if (arg('--identity')) throw new Error('--credential 与 --identity 只能选一个');
    const credential = readJson(credentialPath, 50000);
    if (credential.format !== 'opencost-access-1' || typeof credential.accessKey !== 'string')
      throw new Error('访问凭证格式错误');
    const origin = endpointOrigin(credential.origin ?? credential.endpoint ?? '');
    if (endpoint && origin !== endpointOrigin(endpoint)) throw new Error('凭证不属于本次目标站点');
    contributorId(credential.accessKey);
    return credential.accessKey as string;
  }
  const explicitPath = arg('--identity');
  const path = explicitPath
    ? resolve(explicitPath)
    : endpoint
      ? defaultAccessKeyPath(endpoint)
      : resolve('.local/client-access.key'); // Local identity inspection only; network callers supply an Origin.
  if (createMissing) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, createAccessKey(), { flag: 'wx', mode: 0o600 });
  }
  const key = readLocalTextSync(path, 1024).trim();
  if (!key.match(/^[A-Za-z0-9_-]{43,128}$/)) throw new Error('访问密钥文件格式错误');
  return key;
};
const statePath = () => resolve(arg('--state', '.local/collection-state.json')!);
const toggle = (value: string | undefined) => {
  if (value !== 'on' && value !== 'off') throw new Error('--incremental 只接受 on 或 off');
  return value === 'on';
};
async function question(prompt: string) {
  if (!stdin.isTTY)
    throw new Error(`${prompt} 请先让用户选择，再通过命令参数传入；当前不会读取历史材料。`);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}
function configureAutomation(state: CollectionSession, mode: string) {
  if (!['off', 'preview', 'upload'].includes(mode))
    throw new Error('--automation 只接受 off、preview 或 upload');
  const next = structuredClone(state);
  next.automation.mode = mode as CollectionSession['automation']['mode'];
  next.automation.configuredAt = new Date().toISOString();
  if (mode !== 'off') {
    if (!state.incrementalEnabled)
      throw new Error('自动运行需要先由用户开启默认增量；关闭增量时自动运行保持关闭');
    const scope = arg('--source-scope', state.automation.sourceScope ?? undefined);
    if (!scope || !existsSync(resolve(scope)))
      throw new Error('开启自动运行需要 --source-scope 指定用户授权的本地来源目录或索引文件');
    next.automation.sourceScope = resolve(scope);
    next.automation.everyHours = Number(arg('--every-hours', String(state.automation.everyHours)));
    const endpoint = arg('--endpoint', state.automation.endpoint ?? state.cursor?.endpoint);
    next.automation.endpoint = endpoint ? endpointOrigin(endpoint) : null;
    const share = arg('--share', state.automation.share)!;
    if (!['private', 'statistics', 'summary'].includes(share)) throw new Error('分享范围无效');
    next.automation.share = share as CollectionSession['automation']['share'];
    if (mode === 'upload' && !next.automation.endpoint)
      throw new Error('自动上传必须确认 --endpoint 目标站点');
    next.automation.contributor = contributorId(identity(next.automation.endpoint ?? undefined));
  }
  return next;
}
function reportAutomation(state: CollectionSession) {
  const value = state.automation;
  console.log(`自动运行偏好：${value.mode}；间隔 ${value.everyHours} 小时。`);
  if (value.mode !== 'off')
    console.log(
      '如果让 AI 定时整理、分类和脱敏历史，会消耗模型额度；纯程序后台只能上传已准备好的结构记录。请分别按用户选择配置。',
    );
  if (value.mode === 'off' && value.scheduleId)
    console.log(`本地自动上传已关闭；请同时暂停宿主调度 ${value.scheduleId}。`);
  else if (value.mode !== 'off')
    console.log(
      value.scheduleId
        ? `已登记宿主调度 ${value.scheduleId}；实际启停状态以宿主为准。`
        : '仅保存了选择，尚未创建定时任务。请由贡献 Skill 使用宿主的自动运行功能创建，并登记 scheduleId。',
    );
}

try {
  if (command === 'check-server') {
    const result = await checkServer(required('--endpoint'));
    const out = arg('--out');
    if (out) saveNewResearchJson(out, result);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'compatible') process.exitCode = 2;
  } else if (command === 'init') {
    const out = required('--out');
    if (existsSync(resolve(out)))
      throw new Error('输出文件已存在，请使用新路径以保留上次材料和失败重试信息');
    let state = readSession(statePath());
    if (args.includes('--extended-observations') && args.includes('--no-extended-observations'))
      throw new Error('扩展分析的开启与关闭选项不能同时使用');
    let window;
    if (args.includes('--scheduled')) {
      if (
        args.includes('--recommended') ||
        arg('--range') ||
        arg('--incremental') ||
        arg('--automation') || args.includes('--extended-observations') || args.includes('--no-extended-observations')
      )
        throw new Error('定时运行不能自行修改用户的时间范围和授权偏好');
      if (
        state.automation.contributor !==
        contributorId(identity(state.automation.endpoint ?? undefined))
      )
        throw new Error('定时运行的访问凭证已变化，需要用户重新选择');
      window = assertAutomaticRun(state);
    } else {
      if (!state.introduced) {
        await sourceIntroduction(resolve(dirname(statePath()), 'verified-source'));
        console.log(
          '原始对话、源码、账号和账单留在本机，只生成脱敏结构预览；当前难度分级关闭。上传内容和分享范围在预览后确认。',
        );
        console.log(
          'AI 整理旧对话会消耗模型额度，现成字段由程序汇总。自动运行和订阅额度监控默认关闭，需要时再开启。',
        );
      }
      let recommended = args.includes('--recommended');
      if (
        !recommended &&
        state.incrementalEnabled === null &&
        !state.automation.configuredAt &&
        !arg('--range') &&
        !arg('--incremental') &&
        !arg('--automation')
      ) {
        const choice = await question(
          '选择初始化方案：1 近 3 天、开启增量、自动运行关闭，仅生成本地模板（推荐）；2 自定义 [1]：',
        );
        if (choice === '' || choice === '1') recommended = true;
        else if (choice !== '2') throw new Error('请选择 1 使用推荐设置，或 2 自定义。');
      }
      let incremental = arg(
        '--incremental',
        recommended && state.incrementalEnabled === null ? 'on' : undefined,
      );
      if (state.incrementalEnabled === null && incremental === undefined)
        incremental = (await question('是否开启默认增量？输入 on 开启、off 关闭 [off]：')) || 'off';
      if (incremental !== undefined) state.incrementalEnabled = toggle(incremental);
      if (!state.incrementalEnabled) state.automation.mode = 'off';
      const endpoint = arg('--endpoint');
      const plan = nextCollection(
        state,
        new Date(),
        endpoint ? endpointOrigin(endpoint) : undefined,
        state.cursor ? contributorId(identity(endpoint ?? state.cursor.endpoint)) : undefined,
      );
      let range = arg('--range');
      if (!range && plan.action === 'nothing_new') throw new Error('本次没有新的时间区间');
      if (!range && plan.action === 'choose_range') {
        if (plan.reason === 'gap_over_three_days')
          console.log('距离上次成功采集终点已超过 3 天，请重新选择范围；不会自动补传整个间隔。');
        range = recommended
          ? '3d'
          : (await question(
              '采集范围：3d 近 3 天（推荐）、1d 近 24 小时；7d/30d/90d 整理可能消耗较多额度 [3d]：',
            )) || '3d';
      }
      if (range && !Object.hasOwn(rangeDays, range))
        throw new Error('--range 只接受 1d、3d、7d、30d 或 90d；增量由成功位置自动确定');
      window = range ? collectionWindow(range as CollectionRange) : plan.window!;
      if (window.range !== 'incremental' && rangeDays[window.range] > 3)
        console.log(largeRangeNotice);
      let automatic = arg(
        '--automation',
        recommended && !state.automation.configuredAt ? 'off' : undefined,
      );
      if (!state.automation.configuredAt && automatic === undefined)
        automatic =
          (await question(
            '是否自动运行？off 关闭（默认）、preview 只生成待确认预览、upload 按授权范围自动上传 [off]：',
          )) || 'off';
      if (automatic !== undefined) state = configureAutomation(state, automatic);
      state.introduced = true;
      if (args.includes('--extended-observations')) state.extendedObservations = true;
      if (args.includes('--no-extended-observations')) state.extendedObservations = false;
      const choices = state;
      state = updateSession(statePath(), (latest) => ({
        ...latest,
        introduced: true,
        incrementalEnabled: choices.incrementalEnabled,
        extendedObservations: choices.extendedObservations,
        automation: choices.automation,
      }));
    }
    saveJson(
      out,
      captureTemplate(window, {
        extendedObservations: state.extendedObservations,
        itemizedCosts: args.includes('--itemized-costs'),
        chargeCoverage: args.includes('--charge-coverage'),
      }),
    );
    if (state.extendedObservations)
      console.log(
        '扩展脱敏分析已开启：只填写授权范围内有依据的固定分类和数值，缺项保持未知。可用 --no-extended-observations 关闭；不上传原文、源码或路径。',
      );
    if (args.includes('--itemized-costs'))
      console.log(
        '已生成逐项费用空模板；按实际账单填写本地 charges，独有费用与明确的共享规则分开。没有归属的费用不自动均摊；不读取账单或开启上传。',
      );
    console.log(describeWindow(window));
    if (args.includes('--charge-coverage'))
      console.log(
        '已生成费用包含关系空模板；只记录同一账期、币种和净额依据，不从代理树推断。未读取账单、调用模型或启用上传。',
      );
    console.log(
      `默认增量：${state.incrementalEnabled ? '开启' : '关闭'}；可用 preferences --incremental on|off 修改。`,
    );
    reportAutomation(state);
    console.log('已生成本地字段模板；null/unknown 是待采集项，模板尚不能上传。');
  } else if (
    ['assess-complexity', 'complexity-packet', 'review-complexity'].includes(command ?? '')
  ) {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留已有复杂度研究记录。');
    const enabled = args.includes('--enabled');
    // Disabled research does not read the task, options, histories, credentials or model answer.
    const options = enabled ? { enabled: true, requirementRevision: required('--revision') } : {};
    const input = enabled
      ? readJson(required('--input'), taskComplexityLimits.inputBytes)
      : undefined;
    let result;
    if (command === 'complexity-packet') {
      result = createComplexityReviewPacket(input, options);
    } else if (command === 'review-complexity') {
      const review = enabled
        ? readJson(required('--review'), COMPLEXITY_REVIEW_MAX_BYTES)
        : undefined;
      result = validateComplexityReview(input, review, options);
    } else {
      const domainReviewPath = enabled ? arg('--domain-review') : undefined;
      const graphPath = enabled ? arg('--graph') : undefined;
      result = computeTaskComplexity(input, {
        ...options,
        ...(domainReviewPath
          ? { domainReview: readJson(domainReviewPath, taskComplexityLimits.inputBytes) }
          : {}),
        ...(graphPath
          ? { dependencyGraph: readJson(graphPath, taskComplexityLimits.inputBytes) }
          : {}),
      });
    }
    saveNewResearchJson(out, result);
    console.log(
      `本地复杂度研究：${result.status}。结果不上传、不进入生产分级或排名；没有调用模型。`,
    );
  } else if (command === 'analyze-journal-task') {
    const out = required('--out');
    if (!args.includes('--enabled')) {
      saveNewResearchJson(out, { format: 'journal-analysis-attachment-1', status: 'disabled' });
      console.log('任务分析默认关闭，未读取输入、调用模型或上传。');
    } else {
      const { createJournalAnalysisProcessor } = await import('../shared/journal-analysis.js');
      const inputPath = arg('--input');
      const text = inputPath
        ? readLocalTextSync(resolve(inputPath), 1024 * 1024)
        : JSON.stringify(
            (await import('./journal-analysis-input.js')).loadJournalAnalysisInput({
              summary: required('--summary'),
              sourceRef: required('--source-ref'),
              task: arg('--task'),
              revision: arg('--revision'),
              reports: arg('--reports'),
              domainReview: arg('--domain-review'),
              graph: arg('--graph'),
            }),
          );
      const result = await createJournalAnalysisProcessor()(text);
      saveNewResearchJson(out, result.attachment);
      console.log(
        '已生成任务绑定的数值附件；难度未校准，结果不进入正式排名。请在应用中预览后保存新修订，上传另行选择。',
      );
    }
  } else if (command === 'measure-code') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留已有代码测量历史。');
    if (arg('--language') === 'python') {
      const enabled = args.includes('--enabled');
      const { measurePythonFile } = await import('./python-code-measurement.js');
      const result = measurePythonFile(enabled ? required('--input') : '', {
        enabled,
        python: arg('--python'),
      });
      saveNewResearchJson(out, result);
      console.log(
        `Python结构测量：${result.status}；${result.reason}。显式选择Python解释器才读取源码；仅保存数值，不执行所选代码，不上传。`,
      );
    } else if (!args.includes('--enabled')) {
      saveNewResearchJson(out, { version: 'code-complexity-1', status: 'disabled', metrics: null });
      console.log('代码结构测量默认关闭；未读取源码，也未加载解析器。');
    } else {
      const language = required('--language');
      if (!['javascript', 'typescript', 'jsx', 'tsx'].includes(language))
        throw new Error(
          '当前支持 javascript、typescript、jsx、tsx、python；Python需显式 --python 解释器绝对路径。其他语言不猜测复杂度。',
        );
      const source = readLocalTextSync(resolve(required('--input')), 1_048_576);
      const { measureCodeComplexity } = await import('./code-complexity.js');
      const result = measureCodeComplexity(
        source,
        language as 'javascript' | 'typescript' | 'jsx' | 'tsx',
      );
      saveNewResearchJson(out, result);
      console.log(
        `本地代码结构测量：${result.status}。仅保存结构统计，不上传源码，不调用模型，不进入任务难度或排名。`,
      );
    }
  } else if (command === 'measure-python-set') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留已有Python测量历史。');
    const enabled = args.includes('--enabled');
    const { measurePythonSet } = await import('./python-code-measurement.js');
    const result = measurePythonSet(enabled ? required('--manifest') : '', {
      enabled,
      python: arg('--python'),
    });
    saveNewResearchJson(out, result);
    console.log(
      `Python清单测量：${result.status}；${result.reason}。一个独立解析进程，代码与文件名不出本地，不调用模型。`,
    );
  } else if (command === 'measure-code-set') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留已有代码测量历史。');
    const enabled = args.includes('--enabled');
    const { measureCodeSet } = await import('./code-measurement-set.js');
    const result = measureCodeSet(enabled ? required('--manifest') : '', { enabled });
    saveNewResearchJson(out, result);
    if (result.status !== 'disabled')
      console.log(
        `清单 ${result.scope.selectedEntries} 条；测得 ${result.scope.measuredFiles} 个不同文件，去重 ${result.scope.duplicateEntries} 条，未测得 ${result.scope.unavailableEntries} 条。范围与阶段来自用户声明。`,
      );
    console.log(
      `多文件代码结构测量：${result.status}。按语言保存结构分布与缺项，不上传、不调用模型、不进入难度或排名。`,
    );
  } else if (command === 'attach-code-measurements') {
    const out = required('--out');
    if (existsSync(resolve(out)))
      throw new Error('请使用新的输出文件，保留原采集清单和代码数值历史。');
    const { loadCodeAttachmentManifest, applyCodeEvidence } =
      await import('./code-observations.js');
    const enabled = args.includes('--enabled');
    const selected = loadCodeAttachmentManifest(enabled ? required('--manifest') : '', { enabled });
    if (selected.status === 'disabled') {
      saveNewResearchJson(out, { format: 'code-observation-attachment-1', status: 'disabled' });
      console.log('附加代码数值默认关闭；未读取采集清单、报告或源码，未上传。');
    } else {
      const packet = CapturePacketSchema.parse(readJson(required('--input'), 64 * 1024 * 1024));
      if (
        packet.codeMeasurements &&
        canonical(packet.codeMeasurements) !== canonical(selected.evidence)
      )
        throw new Error('本地采集清单已有不同代码绑定，原清单保留，请使用对应要求和报告。');
      const counts = applyCodeEvidence(structuredClone(packet.envelope), selected.evidence);
      packet.codeMeasurements = selected.evidence;
      saveNewResearchJson(out, packet);
      console.log(
        `已在本地为${counts.tasks}项根目标附加${counts.snapshots}份代码快照和${counts.patches}份补丁；请继续capture、prepare并预览上传内容。未调用模型、读取源码或发送网络请求。`,
      );
    }
  } else if (command === 'measure-patch') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留原补丁测量历史。');
    const { measurePatchManifest } = await import('./patch-measurement.js');
    const enabled = args.includes('--enabled');
    const result = measurePatchManifest(enabled ? required('--manifest') : '', { enabled });
    saveNewResearchJson(out, result);
    console.log(
      `本地补丁计量：${result.status}；${result.reason}。只保存结构数值，不应用补丁、不上传、不推断已完成工作或任务难度。`,
    );
  } else if (command === 'compare-code-reports') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留原代码比较结果。');
    const { compareCodeMeasurementReports, CODE_REPORT_IMPORT_BYTES } =
      await import('../shared/code-measurement-import.js');
    const enabled = args.includes('--enabled');
    const result = compareCodeMeasurementReports(
      enabled ? readJson(required('--before'), CODE_REPORT_IMPORT_BYTES) : null,
      enabled ? readJson(required('--after'), CODE_REPORT_IMPORT_BYTES) : null,
      { enabled, sameScopeConfirmed: args.includes('--same-scope-confirmed') },
    );
    saveNewResearchJson(out, result);
    console.log(
      `本地代码结构比较：${result.status}。只作同范围描述性差值，不判断质量、工作价值或难度，不上传。`,
    );
  } else if (command === 'settlement-start' || command === 'settlement-revise') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留原结算快照与修订依据。');
    const { startSettlement, reviseSettlement } = await import('./settlement-revision.js');
    const input = readJson(required('--input'), 512 * 1024);
    const result =
      command === 'settlement-start'
        ? startSettlement(input)
        : reviseSettlement(readJson(required('--previous'), 4 * 1024 * 1024), input);
    // The normal transport-size guard also applies to the expanded manifest.
    prepareDraft(result);
    saveNewResearchJson(out, result);
    console.log(
      `已准备完整快照修订 ${result.settlement!.revision}；原记录保留，费用按整个新版替代，不按差额相加。没有扫描历史、查询账户、调用模型或上传。请继续 prepare 预览后确认。`,
    );
  } else if (command === 'economic-history-analyze' || command === 'economic-history-template') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留原经济事件及当时分析。');
    if (command === 'economic-history-template') {
      const { economicHistoryExample } = await import('../shared/economic-history-example.js');
      saveNewResearchJson(out, economicHistoryExample());
      console.log('已保存经济事件方法示例，不是用户的实际账单；没有读取账号或历史。');
    } else {
      const { analyzeEconomicHistory, economicHistoryLines } =
        await import('../shared/economic-history.js');
      const { economicHistoryLimits } = await import('../shared/economic-history-schema.js');
      const enabled = args.includes('--enabled');
      const report = analyzeEconomicHistory(
        enabled ? readJson(required('--input'), economicHistoryLimits.bytes) : undefined,
        { enabled },
      );
      saveNewResearchJson(out, report);
      for (const line of economicHistoryLines(report)) console.log(line);
      console.log('文件只在本地处理；未上传、读取支付账号或调用模型，不改变现有结算、费用及排名。');
    }
  } else if (command === 'task-history-analyze' || command === 'task-history-template') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留原要求历史与旧分析。');
    if (command === 'task-history-template') {
      const { requirementHistoryExample } = await import('./requirement-history-example.js');
      saveNewResearchJson(out, requirementHistoryExample());
      console.log('已保存明确情景的要求、验收与重开账本；其中本地标识不用于上传。');
    } else {
      const { analyzeRequirementHistory } = await import('./requirement-history.js');
      const enabled = args.includes('--enabled');
      const report = analyzeRequirementHistory(
        enabled ? readJson(required('--input'), 4 * 1024 * 1024) : undefined,
        { enabled },
      );
      saveNewResearchJson(out, report);
      console.log(
        `本地要求历史：${report.status}；已提供根目标 ${report.tasks.length} 个。没有读取其他历史、调用模型或上传。`,
      );
      if (['invalid', 'conflict', 'capacity'].includes(report.status)) process.exitCode = 1;
    }
  } else if (command === 'quota-portfolio' || command === 'quota-portfolio-template') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留已有组合比较与输入。');
    if (command === 'quota-portfolio-template') {
      const { quotaPortfolioExample } = await import('../shared/quota-portfolio-example.js');
      saveNewResearchJson(out, quotaPortfolioExample());
      console.log('已保存明确情景的多订阅组合模板；请登记真实费用、共享额度、资格和允许分配。');
    } else {
      const { compareQuotaPortfolio } = await import('../shared/quota-portfolio.js');
      const { quotaPortfolioLimits } = await import('../shared/quota-portfolio-schema.js');
      const enabled = args.includes('--enabled');
      const report = compareQuotaPortfolio(
        enabled ? readJson(required('--input'), quotaPortfolioLimits.bytes) : undefined,
        { enabled },
      );
      saveNewResearchJson(out, report);
      console.log(
        `本地组合比较：${report.status}；分配组合 ${report.search.assignmentConfigurations} 个，已处理 ${report.search.evaluatedConfigurations} 个。没有查询账号、调用模型或上传。`,
      );
    }
  } else if (command === 'quota-plan-compare' || command === 'quota-plan-template') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留已有套餐比较与输入。');
    if (command === 'quota-plan-template') {
      const { quotaPlanComparisonExample } =
        await import('../shared/quota-plan-comparison-example.js');
      saveNewResearchJson(out, quotaPlanComparisonExample());
      console.log('已保存明确标为情景的有限候选模板；请填写实际版本、资格、换算和完整费用。');
    } else {
      const { compareQuotaPlans } = await import('../shared/quota-plan-comparison.js');
      const { quotaPlanComparisonLimits } =
        await import('../shared/quota-plan-comparison-schema.js');
      const enabled = args.includes('--enabled');
      const report = compareQuotaPlans(
        enabled ? readJson(required('--input'), quotaPlanComparisonLimits.bytes) : undefined,
        { enabled },
      );
      saveNewResearchJson(out, report);
      console.log(
        `本地套餐比较：${report.status}；满足偏好的已评估候选 ${report.selection.eligible} 个，并列较优 ${report.selection.candidateRefs.length} 个。没有查询账号、调用模型或上传。`,
      );
    }
  } else if (command === 'quota-observation-import' || command === 'quota-observation-template') {
    const out = required('--out'),
      scenarioOut = arg('--scenario-out');
    if (
      existsSync(resolve(out)) ||
      (scenarioOut &&
        (existsSync(resolve(scenarioOut)) ||
          resolve(scenarioOut).toLowerCase() === resolve(out).toLowerCase()))
    )
      throw new Error('请使用不同的新输出文件，保留原始观察与核对历史。');
    if (command === 'quota-observation-template') {
      const { quotaObservationImportExample } =
        await import('../shared/quota-observation-import-example.js');
      saveNewResearchJson(out, quotaObservationImportExample());
      console.log(
        '已生成明确标为情景的观测导入示例，包含期初/期末状态、到达与扣除时间和重置映射。请按真实来源填写。',
      );
    } else {
      const { prepareQuotaReplayFromObservations } =
        await import('../shared/quota-observation-import.js');
      const { quotaObservationImportLimits } =
        await import('../shared/quota-observation-import-schema.js');
      const enabled = args.includes('--enabled');
      const result = prepareQuotaReplayFromObservations(
        enabled ? readJson(required('--input'), quotaObservationImportLimits.bytes) : undefined,
        { enabled },
      );
      saveNewResearchJson(out, result);
      if (scenarioOut && result.status === 'ready' && result.input)
        saveNewResearchJson(scenarioOut, result.input);
      console.log(
        `本地额度观测转换：${result.status}。已保存核对报告；${scenarioOut && result.status === 'ready' ? '已另存可运行情景。' : '未另存运行情景。'}没有查询账号、调用模型或上传。`,
      );
    }
  } else if (command === 'quota-replay' || command === 'quota-replay-template') {
    const out = required('--out');
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留已有额度回放记录。');
    const { replayQuota, quotaReplayExample } = await import('../shared/quota-replay.js');
    if (command === 'quota-replay-template') {
      saveNewResearchJson(out, quotaReplayExample());
      console.log('已生成明确标为情景的示例：一个共享池、两个请求和一次重置；请按真实规则修改。');
    } else {
      const enabled = args.includes('--enabled');
      const { quotaReplayLimits } = await import('../shared/quota-replay-schema.js');
      const result = replayQuota(
        enabled ? readJson(required('--input'), quotaReplayLimits.bytes) : undefined,
        { enabled },
      );
      saveNewResearchJson(out, result);
      console.log(
        `本地共享额度回放：${result.status}。没有查询账户、调用模型或上传；请求获准不代表任务验收。`,
      );
    }
  } else if (command === 'calibrate-difficulty') {
    const out = required('--out');
    // The research command never reads histories, enables collection or makes a request.
    // Explicit enable is required before even reading the selected anchor matrix.
    const enabled = args.includes('--enabled');
    const input = enabled ? readJson(required('--input')) : undefined;
    const result = calibrateDifficulty(input, { enabled });
    if (existsSync(resolve(out))) throw new Error('请使用新的输出文件，保留已有校准历史。');
    saveJson(out, result);
    console.log(`本地难度研究：${result.status}。结果不进入上传、生产分级或排名；没有调用模型。`);
  } else if (command === 'preferences') {
    let state = readSession(statePath());
    const incremental = arg('--incremental'),
      automatic = arg('--automation'),
      scheduleId = arg('--schedule-id');
    if (incremental !== undefined || automatic !== undefined || scheduleId !== undefined) {
      state = updateSession(statePath(), (latest) => {
        if (incremental !== undefined) {
          latest.incrementalEnabled = toggle(incremental);
          if (!latest.incrementalEnabled) latest.automation.mode = 'off';
        }
        if (automatic !== undefined) latest = configureAutomation(latest, automatic);
        if (scheduleId !== undefined)
          latest.automation.scheduleId = scheduleId === 'none' ? null : scheduleId;
        return latest;
      });
    }
    console.log(JSON.stringify(state, null, 2));
    reportAutomation(state);
  } else if (command === 'source') {
    if (args.includes('--verify'))
      await sourceIntroduction(resolve(dirname(statePath()), 'verified-source'));
    else console.log(JSON.stringify(readSource(), null, 2));
  } else if (command === 'inspect-dsh') {
    const result = inspectDsh(readJson(required('--input'), 32 * 1024 * 1024));
    saveJson(required('--out'), result);
    console.log('已生成本地代理根映射清单；填写真实根目标 UUID，不能把会话数当作已完成任务数。');
  } else if (command === 'import-dsh') {
    const out = required('--out');
    const quotaOut = arg('--quota-out');
    if (existsSync(resolve(out)) || (quotaOut && existsSync(resolve(quotaOut))))
      throw new Error('请使用新的输出路径，保留原始导出和上次草稿');
    const input = readJson(required('--input'), 32 * 1024 * 1024);
    const mappingFile = arg('--mapping');
    const result = importDsh(
      input,
      readJson(required('--capture'), 64 * 1024 * 1024),
      mappingFile ? readJson(mappingFile) : {},
    );
    const snapshots = quotaOut
      ? dshSubscriptionSnapshots(input, result.packet.envelope.collectionWindow)
      : null;
    saveJson(out, result.packet);
    if (quotaOut)
      saveJson(quotaOut, {
        format: 'opencost-dsh-quota-draft-1',
        snapshots,
        consent: { store: false },
      });
    console.log(JSON.stringify(result.report, null, 2));
    console.log(
      '仅保存本地草稿，未开启监控或自动上传；继续核对缺项后使用 capture、prepare、submit。',
    );
  } else if (command === 'reconcile-charges') {
    const packet = CapturePacketSchema.parse(readJson(required('--input'), 64 * 1024 * 1024));
    if (!packet.chargeCoverage) throw new Error('本地诊断需要 chargeCoverage 包含关系');
    const { summary } = reconcileCharges({ ...packet, chargeCoverage: packet.chargeCoverage });
    saveNewResearchJson(required('--out'), { format: 'opencost-charge-diagnostic-1', summary });
    console.log('已保存费用包含关系诊断；未上传、未读取其他记录。状态：' + summary.status);
  } else if (command === 'summary-template') {
    const facts = manualSummaryTemplate({ day: required('--day'), timeZone: arg('--time-zone', 'Asia/Shanghai')!,
      startAt: required('--start'), endAt: required('--end') }, required('--harness'));
    saveNewResearchJson(required('--out'), facts);
    console.log('已生成无适配器摘要模板；请从授权材料填写 tasks 和已知 calls。未读取历史、未联网。');
  } else if (command === 'summarize') {
    const { summary, report } = compileManualSummary(readJson(required('--input'), 16 * 1024 * 1024));
    saveNewResearchJson(required('--out'), summary);
    console.log(JSON.stringify(report, null, 2));
    console.log('已生成脱敏工作日记；完整 Token 与实付未知时保留 null，调用小计单独记录。');
  } else if (command === 'journal-prepare') {
    const draft = prepareJournal(readJson(required('--input'))), output = required('--out');
    if (existsSync(output)) {
      const previous = readJson(output);
      if (previous.format !== draft.format || previous.digest !== draft.digest || prepareJournal(previous.summary).digest !== draft.digest)
        throw new Error('已有预览不同，请使用新路径；重试保留原预览与 ID');
    } else saveNewResearchJson(output, draft);
    console.log(`已生成私有工作日记预览；${draft.summary.tasks.length} 项目标。内容摘要：${draft.digest}`);
    console.log('请核对输出文件完整 summary；当前未上传，不进入性价比排名。');
  } else if (command === 'journal-submit') {
    if (args.includes('--automatic')) throw new Error('无适配器日记请先确认预览；此命令不会开启自动上传或改变增量位置');
    const saved = readJson(required('--preview'));
    if (saved.format !== 'opencost-journal-preview-1') throw new Error('文件不是工作日记预览');
    const draft = prepareJournal(saved.summary);
    if (draft.digest !== saved.digest || required('--confirmed-digest') !== draft.digest)
      throw new Error('本次确认与日记内容不一致，请重新预览');
    const endpoint = endpointOrigin(required('--endpoint')), key = identity(endpoint);
    const result = await uploadWorkJournal(endpoint, key, draft.summary);
    const input = { origin: endpoint, accessKey: key, receipt: result };
    const root = resolve(dirname(statePath()), 'receipts');
    const history = saveReceiptHistory(input, root);
    console.log(`工作日记已保存：${result.id}；历史回执：${history.path}`);
    const credential = saveReceiptCredential(input, root);
    console.log(`访问凭证：${credential.path}（仅本地保存）`);
    console.log(`私人反馈链接（含访问凭证，请勿公开）：${result.feedbackUrl}`);
    if (result.feedback) console.log(renderFeedbackText(result.feedback));
    console.log('同一访问身份可关联 GitHub 账号。本次日记未改变公开范围或增量位置。');
  } else if (command === 'capture') {
    const result = compileCapture(readJson(required('--input'), 64 * 1024 * 1024));
    saveJson(required('--out'), result.envelope);
    console.log('本地采集编译完成，原始清单、代理标识和费用事实标识未写入上传文件。');
    console.log(JSON.stringify(result.report));
  } else if (command === 'schema') {
    const { z } = await import('zod');
    const format = arg('--format', 'envelope');
    if (
      ![
        'envelope',
        'capture',
        'summary-facts',
        'quota-observation-import',
        'quota-plan-comparison',
        'quota-portfolio',
        'task-history',
        'python-code-report',
        'python-code-manifest',
        'code-set-report',
        'patch-report',
        'patch-manifest',
        'code-observations',
        'code-attachment-manifest',
        'journal-analysis-input',
        'journal-analysis-attachment',
        'economic-history',
        'economic-history-report',
      ].includes(format!)
    )
      throw new Error(
        '--format 只接受 envelope、capture、quota-observation-import、quota-plan-comparison、quota-portfolio、task-history、python-code-report、python-code-manifest、code-set-report、patch-report、patch-manifest、code-observations、code-attachment-manifest、economic-history 或 economic-history-report',
      );
    if (format === 'summary-facts') {
      saveNewResearchJson(required('--out'), z.toJSONSchema(ManualSummaryFactsSchema, { unrepresentable: 'any' }));
    } else if (format === 'journal-analysis-input' || format === 'journal-analysis-attachment') {
      const { JournalAnalysisInputSchema } = await import('../shared/journal-analysis.js');
      const { JournalAnalysisAttachmentSchema } =
        await import('../shared/journal-analysis-schema.js');
      saveNewResearchJson(
        required('--out'),
        z.toJSONSchema(
          format === 'journal-analysis-input'
            ? JournalAnalysisInputSchema
            : JournalAnalysisAttachmentSchema,
          { unrepresentable: 'any' },
        ),
      );
    } else if (format === 'economic-history' || format === 'economic-history-report') {
      const { LocalEconomicHistorySchema, EconomicHistoryReportSchema } =
        await import('../shared/economic-history-schema.js');
      saveNewResearchJson(
        required('--out'),
        z.toJSONSchema(
          format === 'economic-history' ? LocalEconomicHistorySchema : EconomicHistoryReportSchema,
          { unrepresentable: 'any' },
        ),
      );
    } else if (format === 'code-observations' || format === 'code-attachment-manifest') {
      const { CodeMeasurementObservationsSchema } =
        await import('../shared/code-observations-schema.js');
      const { LocalCodeAttachmentManifestSchema } = await import('./code-observations.js');
      saveNewResearchJson(
        required('--out'),
        z.toJSONSchema(
          format === 'code-observations'
            ? CodeMeasurementObservationsSchema
            : LocalCodeAttachmentManifestSchema,
          { unrepresentable: 'any' },
        ),
      );
    } else if (format === 'patch-report' || format === 'patch-manifest') {
      const { PatchMeasurementReportSchema, PatchMeasurementManifestSchema } =
        await import('../shared/patch-measurement-schema.js');
      saveNewResearchJson(
        required('--out'),
        z.toJSONSchema(
          format === 'patch-report' ? PatchMeasurementReportSchema : PatchMeasurementManifestSchema,
          { unrepresentable: 'any' },
        ),
      );
    } else if (format === 'code-set-report') {
      const { CodeMeasurementSetSchema } = await import('../shared/code-measurement-set-schema.js');
      saveNewResearchJson(
        required('--out'),
        z.toJSONSchema(CodeMeasurementSetSchema, { unrepresentable: 'any' }),
      );
    } else if (format === 'python-code-report' || format === 'python-code-manifest') {
      const { PythonCodeMeasurementSchema, PythonMeasurementManifestSchema } =
        await import('../shared/python-code-measurement-schema.js');
      saveNewResearchJson(
        required('--out'),
        z.toJSONSchema(
          format === 'python-code-report'
            ? PythonCodeMeasurementSchema
            : PythonMeasurementManifestSchema,
          { unrepresentable: 'any' },
        ),
      );
    } else if (format === 'task-history') {
      const { LocalRequirementHistorySchema } = await import('./requirement-history.js');
      saveNewResearchJson(
        required('--out'),
        z.toJSONSchema(LocalRequirementHistorySchema, { unrepresentable: 'any' }),
      );
    } else if (format === 'quota-portfolio') {
      const { QuotaPortfolioSchema } = await import('../shared/quota-portfolio-schema.js');
      saveNewResearchJson(
        required('--out'),
        z.toJSONSchema(QuotaPortfolioSchema, { unrepresentable: 'any' }),
      );
    } else if (format === 'quota-plan-comparison') {
      const { QuotaPlanComparisonSchema } =
        await import('../shared/quota-plan-comparison-schema.js');
      saveNewResearchJson(
        required('--out'),
        z.toJSONSchema(QuotaPlanComparisonSchema, { unrepresentable: 'any' }),
      );
    } else if (format === 'quota-observation-import') {
      const { QuotaObservationImportSchema } =
        await import('../shared/quota-observation-import-schema.js');
      saveNewResearchJson(
        required('--out'),
        z.toJSONSchema(QuotaObservationImportSchema, { unrepresentable: 'any' }),
      );
    } else
      saveJson(
        required('--out'),
        z.toJSONSchema(format === 'capture' ? CapturePacketSchema : EnvelopeSchema, {
          unrepresentable: 'any',
        }),
      );
  } else if (command === 'prepare') {
    const envelope = EnvelopeSchema.parse(readJson(required('--input')));
    const share = arg('--share', 'private');
    if (!['private', 'statistics', 'summary'].includes(share!))
      throw new Error('--share 只接受 private、statistics 或 summary');
    envelope.consent = {
      version: 'opencost-1.0',
      store: true,
      statistics: share !== 'private',
      publicSummary: share === 'summary',
    };
    const draft = prepareDraft(envelope);
    const output = resolve(required('--out'));
    let reused = false;
    if (existsSync(output)) {
      try {
        const previous = readJson(output, 4 * 1024 * 1024) as PreparedDraft;
        if (
          previous.format !== 'opencost-preview-1' ||
          typeof previous.idempotencyKey !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
            previous.idempotencyKey,
          ) ||
          previous.digest !== draft.digest ||
          prepareDraft(previous.envelope).digest !== draft.digest
        )
          throw new Error('existing preview differs');
        draft.idempotencyKey = previous.idempotencyKey;
        reused = true;
      } catch {
        throw new Error(
          '已有预览内容不同或无法校验，文件与原幂等键保留；请另存到新路径，失败重试继续使用原预览。',
        );
      }
    } else {
      mkdirSync(dirname(output), { recursive: true });
      // Exclusive creation keeps a concurrent prepare from replacing the first request key.
      writeFileSync(output, JSON.stringify(draft, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
    console.log(
      reused ? '已保留原预览和幂等键，未发送网络请求。' : '已在本地生成预览，未发送网络请求。',
    );
    if (envelope.collectionWindow) console.log(describeWindow(envelope.collectionWindow));
    console.log(
      `${envelope.period.month} ${envelope.period.currency} 净支出 ${draft.analysis.net === null ? '未知' : (draft.analysis.net / 100).toFixed(2)}，${draft.analysis.tasks} 项任务，${draft.analysis.accepted} 项通过验收。`,
    );
    console.log(`完整 Token：${draft.analysis.tokens ?? '未知'}；API 等价费用（最小货币单位）：${draft.analysis.equivalentMinor ?? '未知'}`);
    for (const reason of draft.usageCalculation?.pricing?.reasons ?? []) console.log(`待补充：${reason}`);
    envelope.tasks.slice(0, 20).forEach((t) => console.log(workSummary(t)));
    const codeNotice = codeObservationNotice(envelope.tasks);
    if (codeNotice) console.log(codeNotice);
    console.log(`分享范围：${share}；内容摘要：${draft.digest}`);
    console.log('请查看输出文件中完整 envelope；修改内容后请使用新输出路径重新 prepare。');
  } else if (command === 'submit') {
    // The local preview also contains derived analysis; only the envelope goes on wire.
    const draft = readJson(required('--preview'), 4 * 1024 * 1024) as PreparedDraft;
    if (draft.format !== 'opencost-preview-1') throw new Error('文件不是贡献预览');
    const endpoint = endpointOrigin(required('--endpoint'));
    const key = identity(endpoint, !args.includes('--automatic'));
    let confirmation = arg('--confirmed-digest');
    let assertCurrentAutomatic: ((state?: CollectionSession) => void) | undefined;
    if (args.includes('--automatic')) {
      if (!draft.envelope.collectionWindow) throw new Error('自动上传缺少采集范围');
      const share = draft.envelope.consent.publicSummary
        ? 'summary'
        : draft.envelope.consent.statistics
          ? 'statistics'
          : 'private';
      const owner = contributorId(key),
        original = readSession(statePath());
      const authority = (state: CollectionSession) =>
        canonical({
          automation: state.automation,
          incrementalEnabled: state.incrementalEnabled,
          cursor: state.cursor,
        });
      const originalAuthority = authority(original);
      assertCurrentAutomatic = (state = readSession(statePath())) => {
        if (authority(state) !== originalAuthority)
          throw new Error('自动上传授权或增量起点已变化；保留原预览和幂等键，请按当前授权重新运行');
        if (contributorId(identity(endpoint, false)) !== owner)
          throw new Error('自动上传凭证已变化；保留原预览和幂等键，请重新确认身份与授权');
        assertAutomaticUpload(state, draft.envelope.collectionWindow!, endpoint, owner, share);
      };
      assertCurrentAutomatic(original);
      confirmation = draft.digest;
    } else if (!confirmation) {
      if (!stdin.isTTY) throw new Error('非交互提交需要本次用户确认后的 --confirmed-digest');
      const rl = createInterface({ input: stdin, output: stdout });
      console.log(`将向 ${endpoint} 保存预览文件中的完整脱敏记录。`);
      console.log(JSON.stringify(draft.envelope, null, 2));
      try {
        confirmation = await rl.question('确认以上内容与分享范围后，输入完整内容摘要：');
      } finally {
        rl.close();
      }
    }
    const proof = arg('--attestation');
    const result = await submitDraft({
      endpoint,
      draft,
      accessKey: key,
      confirmedDigest: confirmation!,
      attestation: proof ? AttestationSchema.parse(readJson(proof)) : null,
      beforeRequest: assertCurrentAutomatic ? () => assertCurrentAutomatic!() : undefined,
    });
    const receiptInput = { origin: endpoint, accessKey: key, receipt: result };
    const historyRoot = resolve(dirname(statePath()), 'receipts');
    let history;
    try {
      history = saveReceiptHistory(receiptInput, historyRoot);
    } catch {
      throw new Error(
        '服务器已保存本次记录，但本地完整回执未能保存，增量位置未更新；请保留原预览、原凭证和幂等键，修复本地存储后重试。',
      );
    }
    console.log(`已保存：${result.id}；状态：${result.status}。本地完整回执已保存。`);
    console.log(`历史回执：${history.path}`);
    console.log(`私人反馈链接（含访问凭证，请勿公开）：${result.feedbackUrl}`);
    if (history.cleanupWarning)
      console.warn('回执已发布，部分临时文件未清理；最终回执保留，后续可检查本地目录。');
    try {
      const credential = saveReceiptCredential(receiptInput, historyRoot);
      console.log(`访问凭证：${credential.path}（导入 CLI 或桌面应用时选择此文件）`);
      if (credential.cleanupWarning) console.warn('访问凭证已保存，部分临时文件未清理。');
    } catch {
      console.warn('完整回执已保存；小型访问凭证未能另存，请继续保留原身份文件。');
    }
    const receiptPath = arg('--receipt');
    if (receiptPath) {
      try {
        // An absent state or lock path must not become a receipt file or directory.
        const comparePath = (path: string) => {
          const absolute = resolve(path);
          return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
        };
        const destination = comparePath(receiptPath);
        for (const reserved of reservedSessionPaths(statePath()).map(comparePath)) {
          if (destination === reserved || destination.startsWith(`${reserved}${sep}`))
            throw new Error('回执导出不能使用状态文件或其锁路径');
        }
        const exported = exportReceiptDocument(receiptInput, receiptPath);
        console.log(`另存回执：${exported.path}`);
        if (exported.cleanupWarning) console.warn('指定回执已保存，部分临时文件未清理。');
      } catch {
        // A prior successful receipt remains useful when optional feedback changed.
        // It never supplies the current request's authorization or collection window.
        let sameHistoricalReceipt = false;
        try {
          const previous = readJson(receiptPath, 5 * 1024 * 1024);
          sameHistoricalReceipt =
            previous.format === 'opencost-access-1' &&
            endpointOrigin(previous.origin) === endpoint &&
            previous.accessKey === key &&
            previous.receipt?.id === result.id &&
            previous.receipt?.digest === result.digest &&
            ['stored', 'quarantined'].includes(previous.receipt?.status);
        } catch {
          /* Preserve an unreadable or unrelated destination without exposing it. */
        }
        if (sameHistoricalReceipt)
          console.warn('指定导出文件保留原历史版本；本次完整回执已另存到历史目录。');
        else {
          console.error(
            '上传及内建历史保存已成功，但指定回执导出未完成，已有文件未覆盖；请改用新路径。增量位置仍按本次成功回执和当前授权处理。',
          );
          process.exitCode = 1;
        }
      }
    }
    console.log(
      result.feedback
        ? renderFeedbackText(result.feedback)
        : '上传已成功，本站暂未返回可校验的个人反馈；可稍后在“我的记录”查看。',
    );
    if (!draft.envelope.collectionWindow) {
      console.log('旧记录没有采集时间窗，本次仅恢复回执，不修改增量位置。');
    } else {
      let state: CollectionSession;
      try {
        state = updateSession(statePath(), (latest) => {
          assertCurrentAutomatic?.(latest);
          return recordSuccessfulUpload(
            latest,
            draft.envelope.collectionWindow!,
            endpoint,
            contributorId(key),
          );
        });
      } catch (error) {
        throw new Error(
          `上传已经成功，回执已保存，但本地增量位置未更新。${safeErrorMessage(error)}`,
        );
      }
      console.log(
        state.batches.some((batch) => batch.id === draft.envelope.collectionWindow!.batch.id)
          ? '本次还有文件未成功上传，增量位置保持不变。'
          : `下次增量起点：${state.cursor?.through}（本次采集终点）。`,
      );
    }
  } else if (command === 'account-connect') {
    const endpoint = endpointOrigin(required('--endpoint'));
    const output = required('--out');
    if (existsSync(resolve(output))) throw new Error('请为关联链接选择一个新文件，避免覆盖已有内容');
    const result = await connectAccount(endpoint, [identity(endpoint)]);
    saveNewResearchJson(output, result);
    console.log('已保存一次性账号关联链接，请在本机浏览器打开文件中的 url，并在 10 分钟内登录 GitHub。完成后可用 account-status 检查；这一步不上传摘要。');
  } else if (command === 'account-status') {
    const endpoint = endpointOrigin(required('--endpoint'));
    console.log(JSON.stringify(await accountConnection(endpoint, identity(endpoint, false))));
  } else if (command === 'identity') {
    console.log(contributorId(identity()));
  } else if (command === 'list') {
    const endpoint = endpointOrigin(required('--endpoint'));
    const limit = arg('--limit');
    const result = await listRecords(endpoint, identity(endpoint), {
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
      ...(arg('--cursor') !== undefined ? { cursor: arg('--cursor') } : {}),
    });
    const out = arg('--out');
    if (out) saveJson(out, result);
    else console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      '本地代码测量：measure-code --input selected.ts --language typescript --out NEW-code.json [--enabled]。支持 javascript/typescript/jsx/tsx，默认关闭，不上传源码。',
      'Python代码测量：measure-code --language python --input selected.py --python 解释器绝对路径 --out NEW-python.json [--enabled]；measure-python-set --manifest selected-python.json --python 解释器绝对路径 --out NEW-python-set.json [--enabled]。固定Radon 6.0.1，默认关闭，不执行所选代码，不自动寻找/安装解释器。',
      '多文件代码测量：measure-code-set --manifest selected-files.json --out NEW-code-set.json [--enabled]。使用用户选择的文件清单，按语言汇总并保留覆盖与测量阶段。',
      '本地补丁计量：measure-patch --manifest selected-patch.json --out NEW-patch-report.json [--enabled]。默认关闭，保留增删行、修改块、分散程度、用途声明和未测内容；不应用补丁、不上传。',
      '附加代码数值：attach-code-measurements --input local-capture.json --manifest selected-reports.json --out NEW-capture.json [--enabled]。默认关闭；本地绑定根目标和要求修订后由capture生成可选上传字段，prepare预览，仍需原上传授权。',
      '结构前后比较：compare-code-reports --before before.json --after after.json --out NEW-comparison.json [--enabled --same-scope-confirmed]。默认关闭，显式确认相同代码范围后才比较同要求、完整覆盖、同语言和解析版本的数值。schema --format code-set-report 可导出JS/TS多文件协议。',
      '共享额度情景：quota-replay-template --out NEW-scenario.json；quota-replay --input scenario.json --out NEW-result.json [--enabled]。默认关闭，显式启用后只读取所选文件，不上传、不调用模型。',
      '额度观测导入：quota-observation-template --out NEW-observations.json；quota-observation-import --input selected.json --out NEW-check.json [--scenario-out NEW-scenario.json] [--enabled]。先核对原始观察与映射，ready才输出可运行情景；默认关闭，不读监控数据库。',
      '有限候选套餐：quota-plan-template --out NEW-plans.json；quota-plan-compare --input selected-plans.json --out NEW-comparison.json [--enabled]。固定同一配置与共同需求，费用/覆盖/等待分别展示，保留完整输入；默认关闭，不联网。',
      '多订阅组合：quota-portfolio-template --out NEW-portfolio.json；quota-portfolio --input portfolio.json --out NEW-result.json [--enabled]。共享额度和费用各记一次，显式允许分配，有界穷举；默认关闭，不联网。',
      '本地要求历史：task-history-template --out NEW-history.json；task-history-analyze --input selected-history.json --out NEW-report.json [--enabled]；schema --format task-history --out NEW-schema.json。默认关闭；要求、成果和事件引用留在本地，capture可按用户选择的taskHistory生成脱敏数量与状态。',
      '本地经济事件：economic-history-template --out NEW-example.json；economic-history-analyze --input selected-ledger.json --out NEW-report.json [--enabled]；schema --format economic-history|economic-history-report。默认关闭；现金窗口和原要求费用分别计算，退款不明时保留范围。含准确金额、时间和本地引用，不直接上传或改变现有结算。',
      '明确结算修订：settlement-start --input record.json --out NEW-record.json；settlement-revise --previous revision-basis.json --input updated-record.json --out NEW-revision.json。previous 为我的记录中下载的修订依据，不能使用含密钥的回执文件。只准备本地完整快照，仍需 prepare/submit 预览确认；原始历史不覆盖。',
    );
    console.log(
      '扩展脱敏分析：init 默认生成空字段，可用 --no-extended-observations 关闭，--extended-observations 重新开启；保留选择。\n逐项费用：init 支持 --itemized-costs，生成独有与共享费用归属空字段，默认不选择。\n累计费用：init 支持 --charge-coverage；明确包含图保留本地，reconcile-charges 只保存金额诊断，不上传。\n本地研究：calibrate-difficulty --input public-anchors.json --out NEW-result.json [--enabled]；默认关闭，不联网、不上传、不进入生产排名。\n',
    );
    console.log(
      '本地复杂度研究（默认关闭，显式 --enabled 才读取指定文件）：\nassess-complexity --input task.json --revision UUID --out NEW-result.json [--enabled] [--domain-review local-review.json] [--graph local-graph.json]\ncomplexity-packet --input task.json --revision UUID --out NEW-packet.json [--enabled]\nreview-complexity --input task.json --revision UUID --review model-answer.json --out NEW-review.json [--enabled]\n输入为单项脱敏 Task；任务要求改变时使用新的修订 UUID，复核时沿用同一版本。模型需在另行授权的本地 Harness 中运行，这些命令不会调用模型。\n每日任务附件：analyze-journal-task --summary diary.json --source-ref SHA256 --reports selected-reports.json --out NEW-attachment.json --enabled [--task task.json --revision UUID --domain-review review.json --graph graph.json]；或使用 --input local-analysis-input.json。只读所选文件，数值附件可在应用任务详情中导入，上传另行选择。schema 支持 journal-analysis-input 和 journal-analysis-attachment。\n',
    );
    console.log(
      '账号汇总：account-connect --endpoint ORIGIN --out NEW-connect.json；在浏览器打开输出文件的 url 并登录 GitHub，再运行 account-status --endpoint ORIGIN。两者使用同一 --credential 或 --identity。关联不上传摘要。\nDSH 适配（纯本地，不开启采集或上传）：\ninspect-dsh --input dsh-export.json --out inspection.json\nimport-dsh --input dsh-export.json --capture capture.json --out NEW-capture.json [--mapping mapping.json] [--quota-out NEW-quota-draft.json]\n',
    );
    console.log(
      `OpenCost-AI 本地贡献客户端\n\n接口检查：check-server --endpoint ORIGIN [--out NEW-check.json]\n\n无适配器摘要：\nsummary-template --day YYYY-MM-DD --time-zone Asia/Shanghai --start UTC --end UTC --harness dsh|codex|claude|opencode --out NEW-facts.json\nsummarize --input facts.json --out NEW-summary.json\njournal-prepare --input summary.json --out NEW-preview.json\njournal-submit --preview preview.json --endpoint ORIGIN --confirmed-digest SHA256\n\ninit --out capture.json [--recommended] [--range 1d|3d|7d|30d|90d] [--incremental on|off] [--automation off|preview|upload]\ninit --scheduled --out NEW-capture.json\npreferences [--incremental on|off] [--automation off|preview|upload --source-scope PATH --endpoint ORIGIN --share private|statistics|summary --every-hours 24] [--schedule-id ID|none]\nsource [--verify]\nschema --out schema.json [--format envelope|capture]\ncapture --input capture.json --out record.json\nreconcile-charges --input capture.json --out NEW-diagnostic.json\nprepare --input record.json --out preview.json [--share private|statistics|summary]\nsubmit --preview preview.json --endpoint https://your-domain [--confirmed-digest SHA256 | --automatic] [--attestation proof.json] [--receipt NEW-PATH]\nlist --endpoint https://your-domain [--out records.json] [--limit 100] [--cursor NEXT_CURSOR]\nidentity [--endpoint ORIGIN | --identity access.key]\n\n首次接受推荐方案后可用 --recommended（近3天、增量开启、自动运行关闭）；只补缺项，不重置已有偏好。间隔超过3天须重新取得范围选择，定时运行不能使用该参数。所有命令可用 --state 指定本地状态文件；完整回执和小型 access.json 保存在该文件旁的 receipts/ 中，均含密钥，不能公开。导入 CLI 或桌面时选择 access.json。自动上传仅在已保存的明确授权范围内运行。\nlist 每页默认 100 条，最多 200 条；结果保留 records、total 与 nextCursor。nextCursor 非空时原样传给 --cursor 读取下一页。\nidentity 只显示提供给验证方的公开持有人代号，不显示密钥。默认访问密钥按精确 Origin 保存在 .local/identities/。旧 .local/client-access.key 与历史保留；访问旧身份请显式使用 --identity .local/client-access.key，并仅指向原站点。`,
    );
  }
} catch (error) {
  console.error(safeErrorMessage(error));
  process.exitCode = 1;
}
