import { contextBridge, ipcRenderer } from 'electron';
const allowed = new Set([
  'finish-intro',
  'settings',
  'bind',
  'toggle-binding',
  'pair-prompt',
  'copy-prompt',
  'generate',
  'upload',
  'feedback-refresh',
  'feedback-read',
  'credential-import',
  'credential-export',
  'approve',
  'deny',
  'export',
  'backup',
  'cancel',
  'show',
  'quit',
]);
contextBridge.exposeInMainWorld('opencost', {
  snapshot: () => ipcRenderer.invoke('journal:snapshot'),
  invoke: (command: string, data: unknown) => {
    if (!allowed.has(command)) return Promise.reject(new Error('未知应用操作'));
    return ipcRenderer.invoke('journal:command', command, data);
  },
  subscribe: (listener: () => void) => {
    const cb = () => listener();
    ipcRenderer.on('journal:changed', cb);
    return () => ipcRenderer.removeListener('journal:changed', cb);
  },
});
