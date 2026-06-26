const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
  launchAgent:       () => ipcRenderer.send('launch-agent'),
  launchViewer:      () => ipcRenderer.send('launch-viewer'),
  installUpdate:     () => ipcRenderer.send('install-update'),
  getVersion:        () => ipcRenderer.invoke('get-version'),
  onUpdateStatus:    cb => ipcRenderer.on('update-status',   (_, s) => cb(s)),
  onUpdateProgress:  cb => ipcRenderer.on('update-progress', (_, p) => cb(p)),
});
