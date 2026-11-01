const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddyApi', {
  ready: () => ipcRenderer.send('ready'),
  setInteractive: (on) => ipcRenderer.send('interactive', on),
  focusSession: (id) => ipcRenderer.send('focus-session', id),
  dismissAll: () => ipcRenderer.send('dismiss-all'),
  onSessions: (cb) => ipcRenderer.on('sessions', (_e, list) => cb(list)),
  moveWindow: (x, y) => ipcRenderer.send('move-window', x, y),
  onSprites: (cb) => ipcRenderer.on('sprites', (_e, s) => cb(s)),
  onAnimal: (cb) => ipcRenderer.on('animal', (_e, id) => cb(id)),
  onScale: (cb) => ipcRenderer.on('scale', (_e, value) => cb(value)),
  onDisplays: (cb) => ipcRenderer.on('displays', (_e, d) => cb(d)),
  onDebugPanel: (cb) => ipcRenderer.on('debug-panel', () => cb()),
});
