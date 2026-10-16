import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  screen,
  Tray,
  Menu,
  dialog,
  clipboard,
  safeStorage,
} from 'electron';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { z } from 'zod';
import { DesktopStore } from './store.js';
import { JournalController } from './controller.js';
import { detectHarnesses } from './harnesses.js';
import { newPairToken, pairingPrompt } from './pairing.js';
import { SettingsSchema } from './model.js';
import { harnessIds } from '../shared/desktop-summary.js';
import { createAccessKey, endpointOrigin } from '../client/sdk.js';
import { digest } from './store.js';
import { stopProcesses } from './process.js';
import { DesktopShutdown } from './lifecycle.js';
import type { JournalPresentation, PresentationModule } from './presentation-contract.js';
import { readAccessCredential } from './credentials.js';

protocol.registerSchemesAsPrivileged([
  { scheme: 'opencost', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.setName('OpenCost Work Journal');
const presentationMode = !app.isPackaged && process.env.OPENCOST_PRESENTATION === '1';
if (presentationMode && !process.env.OPENCOST_DATA_DIR) throw new Error('需要设置独立的数据目录');
const dataDirectory =
  !app.isPackaged && process.env.OPENCOST_DATA_DIR
    ? resolve(process.env.OPENCOST_DATA_DIR)
    : join(app.getPath('appData'), 'OpenCost Work Journal');
mkdirSync(dataDirectory, { recursive: true });
app.setPath('userData', dataDirectory);
let main: BrowserWindow | null = null,
  popup: BrowserWindow | null = null,
  tray: Tray | null = null;
let store: DesktopStore,
  controller: JournalController,
  quitting = false,
  pairPrompt = '';
const renderer = resolve(__dirname, 'renderer');
const origin = 'opencost://journal';
const preload = join(__dirname, 'preload.cjs');
function changed() {
  for (const w of [main, popup]) if (w && !w.isDestroyed()) w.webContents.send('journal:changed');
  if (!controller.pending && popup && !popup.isDestroyed()) {
    popup.close();
    popup = null;
  }
}
function windowOptions() {
  return {
    backgroundColor: '#f4f7f6',
    icon: join(__dirname, 'icon.png'),
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  };
}
function protect(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.on('will-attach-webview', (e) => e.preventDefault());
}
function showMain() {
  if (!main || main.isDestroyed()) {
    main = new BrowserWindow({
      ...windowOptions(),
      width: 1430,
      height: 930,
      minWidth: 1060,
      minHeight: 720,
      title: 'OpenCost · 工作日记',
      autoHideMenuBar: true,
      show: false,
    });
    protect(main);
    main.loadURL(origin + '/index.html');
    main.once('ready-to-show', () => main?.show());
    main.on('close', (e) => {
      if (!quitting && tray) {
        e.preventDefault();
        main?.hide();
      }
    });
    main.on('closed', () => {
      main = null;
    });
  } else {
    main.show();
    main.focus();
  }
}
function showApproval() {
  if (!controller.pending) return;
  if (popup && !popup.isDestroyed()) {
    popup.show();
    popup.focus();
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  popup = new BrowserWindow({
    ...windowOptions(),
    width: 430,
    height: 400,
    x: area.x + area.width - 450,
    y: area.y + area.height - 420,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    frame: false,
    show: false,
  });
  protect(popup);
  popup.loadURL(origin + '/index.html#/approval');
  popup.once('ready-to-show', () => popup?.show());
  popup.on('closed', () => {
    popup = null;
  });
}
function paired(args: string[]) {
  if (quitting) return;
  try {
    const binding = controller.pair(args);
    if (binding) {
      controller.message = '已绑定 ' + binding.harness + '，生成与上传仍需允许';
      pairPrompt = '';
      changed();
      showMain();
    }
  } catch (e) {
    controller.message = e instanceof Error ? e.message : '绑定失败';
    changed();
    showMain();
  }
}
function makePairPrompt() {
  const token = newPairToken(store);
  pairPrompt = pairingPrompt(process.execPath, token);
  if (!app.isPackaged)
    pairPrompt = pairPrompt.replace(
      `& '${process.execPath.replace(/'/g, "''")}'`,
      `& '${process.execPath.replace(/'/g, "''")}' '${join(__dirname, 'main.cjs').replace(/'/g, "''")}'`,
    );
  return pairPrompt;
}
function authorizeSender(event: Electron.IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  const parsed = url ? new URL(url) : null;
  if (
    ![main?.webContents.id, popup?.webContents.id].includes(event.sender.id) ||
    parsed?.protocol !== 'opencost:' ||
    parsed?.hostname !== 'journal' ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error('非应用窗口不能操作日记');
}
const bindingArg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const instanceData = {
  token: bindingArg('--bind-token'),
  harness: bindingArg('--harness'),
  source: bindingArg('--source'),
};
if (!app.requestSingleInstanceLock(instanceData)) app.quit();
else {
  app.on('second-instance', (_e, args, _cwd, additional) => {
    if (quitting) return;
    const incoming = additional as typeof instanceData;
    const bindingArgs =
      incoming?.token && incoming?.harness && incoming?.source
        ? [
            '--bind-token',
            incoming.token,
            '--harness',
            incoming.harness,
            '--source',
            incoming.source,
          ]
        : args;
    if (store) paired(bindingArgs);
    showMain();
  });
  app.whenReady().then(async () => {
    protocol.handle('opencost', (req) => {
      const url = new URL(req.url);
      if (url.host !== 'journal') return new Response('Not found', { status: 404 });
      const path = resolve(renderer, '.' + decodeURIComponent(url.pathname)),
        rel = relative(renderer, path);
      if (isAbsolute(rel) || rel.startsWith('..'))
        return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(path).toString());
    });
    app.on('web-contents-created', (_e, contents) => {
      contents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
      contents.session.setPermissionCheckHandler(() => false);
    });
    const directory = app.getPath('userData');
    store = new DesktopStore(directory);
    store.recoverAttempts();
    const presentation: JournalPresentation | null = presentationMode
      ? await (
          require(join(__dirname, 'presentation.cjs')) as PresentationModule
        ).createJournalPresentation(directory, store)
      : null;
    controller = new JournalController(store, presentation?.harnesses ?? detectHarnesses(), {
      directory,
      changed,
      approval: showApproval,
      accessKey: (endpoint) => {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error('系统安全存储不可用，本次不保存访问密钥或上传');
        const saved = store.get<string>('access:' + endpoint);
        if (saved) return safeStorage.decryptString(Buffer.from(saved, 'base64'));
        const key = createAccessKey();
        store.set('access:' + endpoint, safeStorage.encryptString(key).toString('base64'));
        return key;
      },
      ...(presentation?.deps ?? {}),
    });
    ipcMain.handle('journal:snapshot', (event) => {
      authorizeSender(event);
      return controller.snapshot(pairPrompt);
    });
    ipcMain.handle('journal:command', async (event, command: unknown, data: unknown) => {
      authorizeSender(event);
      const cmd = z.string().parse(command);
      if (cmd !== 'quit') controller.assertOpen();
      // The small approval window only acts on its current request.
      if (event.sender.id === popup?.webContents.id && !['approve', 'deny', 'show'].includes(cmd))
        throw new Error('提醒窗口不能更改设置或来源');
      switch (cmd) {
        case 'finish-intro':
          controller.settings({ ...store.settings(), introduced: true });
          return;
        case 'settings': {
          const configuration = controller.configurationToken();
          const next = SettingsSchema.parse(data),
            current = store.settings();
          if (presentation && next.endpoint !== presentation.endpoint)
            throw new Error('当前窗口仅连接已配置的本地服务');
          if (
            presentation &&
            (next.generationMode === 'automatic' ||
              next.uploadMode === 'automatic' ||
              next.startAtLogin)
          )
            throw new Error('当前运行保持逐次允许与手动启动');
          const permissions = [];
          if (next.generationMode === 'automatic' && current.generationMode !== 'automatic')
            permissions.push(
              '按所选时间读取绑定日志，将本地遮盖后的片段发送给所选 Harness 的模型服务。会消耗模型额度；遮盖不能保证识别所有业务名称。',
            );
          if (next.uploadMode === 'automatic' && current.uploadMode !== 'automatic')
            permissions.push(
              '生成后自动上传固定类别、数量、状态、Token 与匿名来源标识到 ' +
                next.endpoint +
                '。原文和路径不上传。',
            );
          if (next.startAtLogin && !current.startAtLogin)
            permissions.push('系统登录时启动应用并驻留托盘。');
          if (permissions.length) {
            const answer = await dialog.showMessageBox(main!, {
              type: 'question',
              title: '授权自动运行',
              message: '允许以下操作？',
              detail: permissions.join('\n\n') + '\n\n可以随时在设置中关闭。',
              buttons: ['取消', '授权'],
              defaultId: 0,
              cancelId: 0,
            });
            if (answer.response !== 1) return false;
          }
          controller.assertConfiguration(configuration);
          controller.settings(next);
          if (app.isPackaged && next.startAtLogin !== current.startAtLogin)
            app.setLoginItemSettings({
              openAtLogin: next.startAtLogin,
              path: process.execPath,
              args: ['--background'],
            });
          return true;
        }
        case 'bind': {
          if (presentation) throw new Error('当前窗口已配置三个来源环境');
          const configuration = controller.configurationToken();
          const harness = z.enum(harnessIds).parse(data),
            detected = controller.harnesses.find((h) => h.id === harness)!;
          const result = await dialog.showOpenDialog(main!, {
            title: '选择 ' + detected.label + ' 的会话日志目录',
            defaultPath: detected.source,
            properties: ['openDirectory'],
          });
          if (!result.canceled && result.filePaths[0]) {
            controller.assertConfiguration(configuration);
            store.bind(harness, result.filePaths[0]);
            controller.changedScope();
          }
          return;
        }
        case 'toggle-binding': {
          const v = z.object({ id: z.string().uuid(), enabled: z.boolean() }).strict().parse(data);
          if (controller.busy) throw new Error('等待生成结束再修改');
          store.toggle(v.id, v.enabled);
          controller.changedScope();
          return;
        }
        case 'pair-prompt':
          makePairPrompt();
          changed();
          return pairPrompt;
        case 'copy-prompt':
          clipboard.writeText(pairPrompt || makePairPrompt());
          return;
        case 'generate':
          return controller.requestGeneration(z.string().parse(data));
        case 'upload':
          return controller.requestUpload(z.string().uuid().parse(data));
        case 'feedback-refresh':
          return controller.refreshFeedback();
        case 'feedback-read':
          return controller.readFeedback(data);
        case 'credential-import': {
          if (presentation) throw new Error('当前窗口已连接本地记录，无需导入访问凭证');
          const configuration = controller.configurationToken();
          const endpoint = store.settings().endpoint;
          if (!endpoint) throw new Error('先在设置中保存上传站点地址');
          if (!safeStorage.isEncryptionAvailable())
            throw new Error('系统安全存储不可用，不能导入访问凭证');
          const selected = await dialog.showOpenDialog(main!, {
            title: '导入 Skill 上传时保存的 OpenCost 访问凭证',
            properties: ['openFile'],
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });
          if (selected.canceled || !selected.filePaths[0]) return false;
          const file = selected.filePaths[0];
          const credential = await readAccessCredential(file, endpoint);
          controller.assertConfiguration(configuration);
          store.setCredential(
            endpoint,
            safeStorage.encryptString(credential.accessKey).toString('base64'),
            digest(credential.accessKey),
          );
          controller.message =
            '已在系统安全存储中保存凭证，可点击读取此身份的个人反馈；原身份历史仍保留';
          changed();
          return true;
        }
        case 'credential-export': {
          const endpoint = store.settings().endpoint;
          if (!endpoint) throw new Error('先保存上传站点地址');
          return controller.saveFile(
            async () => {
              const target = await dialog.showSaveDialog(main!, {
                title: '保存私人访问凭证，可用于 Skill 上传和读取个人记录；不要分享',
                defaultPath: 'opencost-access.json',
                filters: [{ name: 'JSON', extensions: ['json'] }],
              });
              return target.canceled || !target.filePath ? null : target.filePath;
            },
            async (destination) =>
              writeFile(
                destination,
                JSON.stringify(
                  {
                    format: 'opencost-access-1',
                    origin: endpoint,
                    accessKey: controller.deps.accessKey(endpoint),
                  },
                  null,
                  2,
                ),
                'utf8',
              ),
          );
        }
        case 'approve':
          return controller.approve(z.string().uuid().parse(data));
        case 'deny':
          return controller.deny(z.string().uuid().parse(data));
        case 'cancel':
          controller.cancel();
          stopProcesses();
          return;
        case 'export': {
          const summary = store.summary(z.string().uuid().parse(data));
          return controller.saveFile(
            async () => {
              const result = await dialog.showSaveDialog(main!, {
                title: '导出脱敏摘要',
                defaultPath: `OpenCost-${summary.day}-r${summary.revision}.json`,
                filters: [{ name: 'JSON', extensions: ['json'] }],
              });
              return result.canceled || !result.filePath ? null : result.filePath;
            },
            async (destination) => writeFile(destination, JSON.stringify(summary, null, 2), 'utf8'),
          );
        }
        case 'backup':
          z.undefined().parse(data);
          return controller.backup(async () => {
            const result = await dialog.showSaveDialog(main!, {
              title: '保存完整私人日记备份，包含本机配置；不是上传摘要',
              defaultPath: `OpenCost-journal-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
              filters: [{ name: 'SQLite', extensions: ['sqlite'] }],
            });
            return result.canceled || !result.filePath ? null : result.filePath;
          });
        case 'show':
          showMain();
          return;
        case 'quit':
          quitting = true;
          app.quit();
          return;
        default:
          throw new Error('未知应用操作');
      }
    });
    tray = new Tray(join(__dirname, 'icon.png'));
    tray.setToolTip('OpenCost · 工作日记');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开工作日记', click: showMain },
        { label: '处理当前提醒', click: showApproval },
        { type: 'separator' },
        {
          label: '退出（停止后台运行）',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('double-click', showMain);
    paired(process.argv);
    if (!process.argv.includes('--background') || !store.settings().introduced) showMain();
    const timer = setInterval(
      () =>
        controller.tick().catch((e) => {
          controller.message = e.message;
          changed();
        }),
      30000,
    );
    timer.unref();
    const shutdown = new DesktopShutdown({
      begin() {
        quitting = true;
        clearInterval(timer);
        // Close admission synchronously, before another IPC or timer callback.
        void controller.close();
        stopProcesses();
      },
      async drain() {
        await controller.close();
        await presentation?.close();
      },
      closeStorage() {
        if (store.db.isOpen) store.close();
      },
      quit() {
        app.quit();
      },
      failed() {
        controller.message = '退出清理未完成，已保留数据库连接；请再次选择退出重试';
        changed();
      },
    });
    app.on('before-quit', (event) => shutdown.beforeQuit(event));
  });
}
app.on('window-all-closed', () => {
  if (!tray) app.quit();
});
