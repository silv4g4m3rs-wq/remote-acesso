'use strict';
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

contextBridge.exposeInMainWorld('settingsAPI', {
  load:          ()    => ipcRenderer.invoke('settings-load'),
  save:          data  => ipcRenderer.invoke('settings-save', data),
  browseFolder:  ()    => ipcRenderer.invoke('settings-browse-folder'),
  getDefaults:   ()    => ipcRenderer.invoke('settings-get-defaults'),
  loadDisplay:   ()    => ipcRenderer.invoke('settings-load-display'),
  saveDisplay:   data  => ipcRenderer.invoke('settings-save-display', data),
});
