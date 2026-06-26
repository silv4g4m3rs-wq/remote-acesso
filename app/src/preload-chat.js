const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatAPI', {
  send:      text => ipcRenderer.send('chat-send', text),
  onMessage: cb   => ipcRenderer.on('chat-message', (_, msg) => cb(msg)),
  onClose:   cb   => ipcRenderer.on('chat-closed',  ()      => cb()),
});
