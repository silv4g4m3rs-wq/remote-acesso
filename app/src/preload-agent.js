const { contextBridge, ipcRenderer } = require('electron');

;(function () {
  let _t = ipcRenderer.sendSync('get-theme');
  function _apply(t) {
    _t = t;
    const root = document.documentElement;
    if (!root) return;
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
  }
  _apply(_t);
  if (!document.documentElement) window.addEventListener('DOMContentLoaded', () => _apply(_t));
  ipcRenderer.on('theme-changed', (_, t) => _apply(t));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => _apply(_t));
}());

contextBridge.exposeInMainWorld('agentAPI', {
  onInit:            cb      => ipcRenderer.on('ui-init',           (_, d) => cb(d)),
  onViewerCount:     cb      => ipcRenderer.on('ui-viewer-count',   (_, n) => cb(n)),
  onCaptureError:    cb      => ipcRenderer.on('ui-capture-error',  (_, m) => cb(m)),
  onNewPassword:     cb      => ipcRenderer.on('ui-new-password',   (_, p) => cb(p)),
  onAccessRequest:   cb      => ipcRenderer.on('ui-access-request', (_, d) => cb(d)),
  copyPassword:      ()      => ipcRenderer.send('ui-copy-password'),
  minimize:          ()      => ipcRenderer.send('ui-minimize'),
  close:             ()      => ipcRenderer.send('ui-close'),
  toggleClipboard:   enabled => ipcRenderer.send('ui-toggle-clipboard', enabled),
  setPassword:       (mode, pwd) => ipcRenderer.send('agent-set-password', { mode, pwd }),
  regenPassword:     ()      => ipcRenderer.send('agent-regen-password'),
  acceptRequest:     id      => ipcRenderer.send('agent-accept-request', id),
  rejectRequest:     id      => ipcRenderer.send('agent-reject-request', id),
});
