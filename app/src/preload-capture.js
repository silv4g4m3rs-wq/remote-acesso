const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSources:       () => ipcRenderer.invoke('get-sources'),
  sendFrame:        (buf, w, h) => ipcRenderer.send('frame', buf, w, h),
  sendMonitorList:  monitors => ipcRenderer.send('monitor-list', monitors),
  onSwitchMonitor:  cb => ipcRenderer.on('switch-monitor', (_, idx) => cb(idx)),
  sendCaptureError: msg => ipcRenderer.send('capture-error', msg),
});
