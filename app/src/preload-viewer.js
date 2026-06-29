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

contextBridge.exposeInMainWorld('electronAPI', {
  onAgentFound:             cb  => ipcRenderer.on('agent-found',      (_, a)    => cb(a)),
  openChatWindow:           name => ipcRenderer.send('open-chat-window', name),
  connect:                  opts => ipcRenderer.invoke('connect', opts),
  disconnect:               ()   => ipcRenderer.send('disconnect'),
  onDisconnected:           cb  => ipcRenderer.on('disconnected',     cb),
  onReconnecting:           cb  => ipcRenderer.on('reconnecting',     (_, a, m) => cb(a, m)),
  onReconnected:            cb  => ipcRenderer.on('reconnected',      cb),
  onReconnectFailed:        cb  => ipcRenderer.on('reconnect-failed', cb),
  onFrame:                  cb  => ipcRenderer.on('frame',            (_, jpeg, w, h) => cb(jpeg, w, h)),
  onMonitorList:            cb  => ipcRenderer.on('monitor-list',     (_, m) => cb(m)),
  switchMonitor:            idx => ipcRenderer.send('monitor-switch', idx),
  sendInput:                msg => ipcRenderer.send('input', msg),
  sendChat:                 text => ipcRenderer.send('chat', text),
  onChat:                   cb  => ipcRenderer.on('chat',             (_, t) => cb(t)),
  pushClipboard:            ()   => ipcRenderer.send('push-clipboard'),
  onClipboardSynced:        cb  => ipcRenderer.on('clipboard-synced', cb),
  sendFile:                 ()   => ipcRenderer.invoke('send-file'),
  onFileProgress:           cb  => ipcRenderer.on('file-progress',   (_, p) => cb(p)),
  onFileIncoming:           cb  => ipcRenderer.on('file-incoming',   (_, i) => cb(i)),
  onFileSaved:              cb  => ipcRenderer.on('file-saved',      (_, p) => cb(p)),
  toggleFullscreen:         mode => ipcRenderer.send('toggle-fullscreen', mode),
  onFullscreenChange:       cb  => ipcRenderer.on('fullscreen-change', (_, fs) => cb(fs)),
  // Display settings
  getDisplaySettings:       ()   => ipcRenderer.invoke('get-display-settings'),
  getDeviceDisplaySettings: host => ipcRenderer.invoke('get-device-display-settings', host),
  onDisplaySettings:        cb  => ipcRenderer.on('display-settings', (_, d) => cb(d)),
  setQuality:               preset => ipcRenderer.send('set-viewer-quality', preset),
  saveDeviceDisplaySettings: (hostname, display) => ipcRenderer.send('save-device-display-settings', { hostname, display }),
  onAccessAccepted:  cb => ipcRenderer.on('access-accepted', cb),
  onAccessRejected:  cb => ipcRenderer.on('access-rejected', cb),
  onWindowFocus:     cb => ipcRenderer.on('window-focus', (_, r) => cb(r)),
  takeScreenshot:    dataUrl => ipcRenderer.invoke('take-screenshot', dataUrl),
});
