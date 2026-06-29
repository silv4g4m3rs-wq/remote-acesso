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

contextBridge.exposeInMainWorld('chatAPI', {
  send:      text => ipcRenderer.send('chat-send', text),
  onMessage: cb   => ipcRenderer.on('chat-message', (_, msg) => cb(msg)),
  onClose:   cb   => ipcRenderer.on('chat-closed',  ()      => cb()),
});
