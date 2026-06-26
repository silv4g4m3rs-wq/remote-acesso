const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentAPI', {
  onInit:          cb      => ipcRenderer.on('ui-init',          (_, d)   => cb(d)),
  onViewerCount:   cb      => ipcRenderer.on('ui-viewer-count',  (_, n)   => cb(n)),
  onCaptureError:  cb      => ipcRenderer.on('ui-capture-error', (_, msg) => cb(msg)),
  copyPassword:    ()      => ipcRenderer.send('ui-copy-password'),
  minimize:        ()      => ipcRenderer.send('ui-minimize'),
  close:           ()      => ipcRenderer.send('ui-close'),
  toggleClipboard: enabled => ipcRenderer.send('ui-toggle-clipboard', enabled),
});
