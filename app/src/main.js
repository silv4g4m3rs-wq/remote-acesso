'use strict';
const {
  app, BrowserWindow, ipcMain, desktopCapturer,
  session, clipboard, dialog, Tray, Menu, nativeImage,
} = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const WebSocket = require('ws');
const { MSG, FILE_CHUNK_SIZE, MAX_FILE_SIZE } = require('../../shared/protocol');
const { createECDH, deriveKey, encrypt, decrypt, makeKexMessage, parseKexMessage } = require('../../shared/crypto');
const { ensureFirewallRules } = require('./firewall');
const { createLogger } = require('../../shared/logger');

const log = createLogger('app-main');

// ── Windows ───────────────────────────────────────────────────────────────────
let launcherWin  = null;
let agentUIWin   = null;
let captureWin   = null;
let viewerWin    = null;
let chatWin      = null;
let agentChatWin = null;
let settingsWin  = null;
let tray         = null;

// Set to true once openLauncher() runs — guards window-all-closed from
// firing app.quit() before the first window has been created.
let _appReady = false;

// ── Agent state ───────────────────────────────────────────────────────────────
let agentServer       = null;
let agentDiscovery    = null;
let agentLastClip     = '';
let agentPassword     = '';
let clipInterval      = null;
let clipEnabled       = false;
let captureRetries    = 0;
let pendingRequests   = new Map(); // id → ws
let pendingReqCounter = 0;

// ── Viewer state ──────────────────────────────────────────────────────────────
let vWs          = null;
let vEncKey      = null;
let vAuthed      = false;
let vDiscovery   = null;
let vLastOpts    = null;
let vIntentional = false;
let vReconnCount = 0;
let vReconnTimer = null;
let vInFile      = null;
let vInChunks    = [];
let _maxToFs     = false; // tracks maximize→fullscreen for hideTaskbarMaximized
const MAX_RECONN = 5;

// ── Chat history ──────────────────────────────────────────────────────────────
let chatLogFile = null;

function appendChatLog(from, text) {
  const s = loadSettings();
  if (s.chatHistoryMode === 'none') return;
  if (!chatLogFile) {
    const dir = s.chatHistoryMode === 'custom' && s.chatHistoryCustomPath
      ? s.chatHistoryCustomPath
      : path.join(app.getPath('userData'), 'chat');
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    chatLogFile = path.join(dir, `chat-${ts}.txt`);
  }
  const time = new Date().toTimeString().slice(0, 8);
  try { fs.appendFileSync(chatLogFile, `[${time}] ${from}: ${text}\n`, 'utf8'); } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let p = '';
  for (let i = 0; i < 6; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

function getLocalIPv4() {
  const VIRTUAL = /loopback|vethernet|vmware|virtualbox|docker|bluetooth|teredo|isatap|6to4/i;
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces()))
    for (const a of addrs)
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.') && !VIRTUAL.test(name))
        candidates.push(a.address);
  return (
    candidates.find(ip => ip.startsWith('10.')) ||
    candidates.find(ip => ip.startsWith('192.168.')) ||
    candidates.find(ip => /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) ||
    candidates[0] || '127.0.0.1'
  );
}

function src(...parts) { return path.join(__dirname, ...parts); }

// ── Settings ──────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  language: 'auto', theme: 'system',
  hideTaskbarMaximized: false, askFeedbackEndSession: false,
  autoOpenChatWindow: false, showSessionInvitePopup: true,
  soundOnConnectionRequest: false, transmitHotkeys: true,
  screenshotDir: 'default', screenshotCustomPath: '',
  chatHistoryMode: 'default', chatHistoryCustomPath: '',
  showOnlineStatus: true, allowUsageData: false,
  agentPasswordMode: 'random', agentFixedPassword: '',
};

const DEFAULT_DISPLAY = {
  quality:                  'balanced',
  cursorMode:               'auto',
  followCursor:             false,
  followWindowFocus:        false,
  showWindowShiftAssistant: false,
  viewMode:                 'fit',
  startFullscreen:          false,
  edgePanning:              false,
  fullscreenMode:           'exclusive',
  hardwareAccel:            'd3d',
  use16bit:                 false,
  perDeviceSettings:        'global',
};

const QUALITY_PRESETS = {
  high:        { fps: 30, quality: 0.90, minQuality: 0.75, maxQuality: 0.90 },
  balanced:    { fps: 30, quality: 0.75, minQuality: 0.50, maxQuality: 0.80 },
  performance: { fps: 60, quality: 0.45, minQuality: 0.30, maxQuality: 0.55 },
};

let _settings = null;

function loadSettings() {
  if (_settings) return _settings;
  try {
    const raw    = fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw);
    _settings    = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      display:   { ...DEFAULT_DISPLAY,  ...(parsed.display   || {}) },
      perDevice: parsed.perDevice || {},
    };
  } catch {
    _settings = { ...DEFAULT_SETTINGS, display: { ...DEFAULT_DISPLAY }, perDevice: {} };
  }
  return _settings;
}

// Prevent Chromium from throttling background renderers (keeps capture running when minimized)
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Apply hardware acceleration from settings before app.whenReady()
;(function () {
  try {
    let userDataDir;
    try { userDataDir = app.getPath('userData'); }
    catch { userDataDir = path.join(process.env.APPDATA || os.homedir(), 'Remote Acesso'); }
    const raw = fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8');
    const s   = JSON.parse(raw);
    switch (s?.display?.hardwareAccel) {
      case 'opengl':     app.commandLine.appendSwitch('use-angle', 'gl');   break;
      case 'directdraw': app.commandLine.appendSwitch('use-angle', 'd3d9'); break;
      case 'none':       app.disableHardwareAcceleration();                  break;
    }
  } catch {}
}());

function saveSettings(data) {
  const prev = _settings || {};
  _settings = {
    ...DEFAULT_SETTINGS,
    ...data,
    display:   prev.display   || DEFAULT_DISPLAY,
    perDevice: prev.perDevice || {},
  };
  try {
    const p = path.join(app.getPath('userData'), 'settings.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(_settings, null, 2), 'utf8');
  } catch (e) { log.error('Falha ao salvar configuracoes', { error: e.message }); }
  if (!_settings.transmitHotkeys) require('./win-key-hook').stopHook();
  broadcastTheme(_settings.theme || 'system');
}

function broadcastTheme(theme) {
  for (const w of [launcherWin, agentUIWin, viewerWin, chatWin, agentChatWin, settingsWin]) {
    try { w?.webContents.send('theme-changed', theme); } catch {}
  }
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520, height: 680,
    resizable: false, maximizable: false,
    title: 'Configuracoes — Remote Acesso',
    webPreferences: { preload: src('preload-settings.js'), contextIsolation: true },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(src('settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ── Chat pop-out ──────────────────────────────────────────────────────────────
function createChatWindow(title = 'Chat') {
  const win = new BrowserWindow({
    width: 340, height: 500,
    minWidth: 260, minHeight: 300,
    title,
    alwaysOnTop: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    webPreferences: { preload: src('preload-chat.js'), contextIsolation: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(src('chat-window.html'));
  return win;
}

function closeChatWin() {
  if (!chatWin) return;
  const w = chatWin; chatWin = null;
  try { w.webContents.send('chat-closed'); } catch {}
  setTimeout(() => { try { w.destroy(); } catch {} }, 1200);
}

function closeAgentChatWin() {
  if (!agentChatWin) return;
  const w = agentChatWin; agentChatWin = null;
  try { w.webContents.send('chat-closed'); } catch {}
  setTimeout(() => { try { w.destroy(); } catch {} }, 1200);
}

// ── Launcher ──────────────────────────────────────────────────────────────────
function openLauncher() {
  if (launcherWin) {
    launcherWin.setAlwaysOnTop(true);
    launcherWin.show();
    launcherWin.focus();
    launcherWin.setAlwaysOnTop(false);
    return;
  }
  launcherWin = new BrowserWindow({
    width: 380, height: 480,
    resizable: false, maximizable: false,
    title: 'Remote Acesso',
    webPreferences: { preload: src('preload-launcher.js'), contextIsolation: true },
  });
  launcherWin.setMenuBarVisibility(false);
  launcherWin.loadFile(src('launcher.html'));
  launcherWin.on('closed', () => { launcherWin = null; });
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
  tray = new Tray(icon);
  tray.setToolTip('Remote Acesso Agent — em execucao');
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir',            click: () => { if (agentUIWin?.isMinimized()) agentUIWin.restore(); agentUIWin?.show(); agentUIWin?.focus(); } },
    { type:  'separator' },
    { label: 'Encerrar sessao',  click: () => { stopAgentMode(); openLauncher(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!agentUIWin) return;
    if (agentUIWin.isMinimized() || !agentUIWin.isVisible()) {
      agentUIWin.show(); agentUIWin.restore(); agentUIWin.focus();
    } else {
      agentUIWin.hide();
    }
  });
}

function destroyTray() { tray?.destroy(); tray = null; }

// ── Agent mode ────────────────────────────────────────────────────────────────
function startAgentMode() {
  if (agentUIWin || captureWin) return;
  const AgentServer    = require('./server');
  const AgentDiscovery = require('./agent-discovery');
  const Input          = require('./input');

  {
    const s = loadSettings();
    if (s.agentPasswordMode === 'fixed' && s.agentFixedPassword?.length >= 4) {
      agentPassword = s.agentFixedPassword;
    } else {
      agentPassword = generatePassword();
    }
  }
  const password = agentPassword;

  agentUIWin = new BrowserWindow({
    width: 320, height: 420,
    title: 'Remote Acesso',
    webPreferences: { preload: src('preload-agent.js'), contextIsolation: true, backgroundThrottling: false },
  });
  agentUIWin.setMenuBarVisibility(false);
  agentUIWin.loadFile(src('agent-ui.html'));
  agentUIWin.webContents.on('did-finish-load', () => {
    agentUIWin.webContents.send('ui-init', {
      password, ip: getLocalIPv4(), hostname: os.hostname(),
    });
    agentUIWin.focus();
  });
  agentUIWin.on('close', e => { e.preventDefault(); agentUIWin?.hide(); });

  agentServer    = new AgentServer(password);
  agentDiscovery = new AgentDiscovery();

  function startCaptureWin() {
    captureWin = new BrowserWindow({
      show: false, width: 1, height: 1,
      webPreferences: {
        preload: src('preload-capture.js'),
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    captureWin.loadFile(src('capture.html'));
    captureWin.on('closed', () => {
      captureWin = null;
      if (agentServer && agentServer.clients.size > 0 && captureRetries < 3) {
        captureRetries++;
        setTimeout(startCaptureWin, 2000);
      }
    });
    captureWin.webContents.on('render-process-gone', (_, details) => {
      log.error('Renderer de captura caiu', { reason: details.reason });
      captureWin?.destroy();
    });
  }

  agentServer.on('access-request', (ws, ip) => {
    const id = ++pendingReqCounter;
    pendingRequests.set(id, ws);
    agentUIWin?.webContents.send('ui-access-request', { id, ip, sound: !!loadSettings().soundOnConnectionRequest });
    // Bring agent window to front so the user sees the request
    if (agentUIWin && !agentUIWin.isDestroyed()) {
      if (agentUIWin.isMinimized()) agentUIWin.restore();
      agentUIWin.show();
      agentUIWin.focus();
      agentUIWin.flashFrame(true);
    }
  });

  agentServer.on('access-request-cancelled', ws => {
    for (const [id, w] of pendingRequests) {
      if (w === ws) { pendingRequests.delete(id); break; }
    }
  });

  agentServer.on('viewer-count', count => {
    agentUIWin?.webContents.send('ui-viewer-count', count);
    if (count > 0 && !captureWin) startCaptureWin();
    if (count === 0) chatLogFile = null;
  });

  agentServer.on('monitor-switch', idx => {
    captureWin?.webContents.send('switch-monitor', idx);
    const m = agentServer.monitors[idx];
    if (m?.width) Input.setScreenBounds(m.width, m.height);
  });

  agentServer.on('input', msg => Input.handleInput(msg));

  agentServer.on('chat', text => {
    appendChatLog('Viewer', text);
    if (!agentChatWin || agentChatWin.isDestroyed()) {
      agentChatWin = createChatWindow('Chat — Viewer');
      agentChatWin.on('closed', () => { agentChatWin = null; });
      agentChatWin.webContents.once('did-finish-load', () =>
        agentChatWin?.webContents.send('chat-message', { from: 'Viewer', text }));
    } else {
      agentChatWin.focus();
      agentChatWin.webContents.send('chat-message', { from: 'Viewer', text });
    }
  });

  agentServer.on('clipboard', text => {
    agentLastClip = text;
    clipboard.writeText(text);
  });

  agentServer.on('quality-change', params => {
    captureWin?.webContents.send('set-capture-quality', params);
  });

  agentServer.on('file-received', ({ name, data }) => {
    // C4: prevent path traversal
    const safeName = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const dest = path.join(os.homedir(), 'Downloads', safeName);
    try { fs.writeFileSync(dest, data); log.info('Arquivo salvo', { dest }); }
    catch (e) { log.error('Falha ao salvar arquivo', { error: e.message }); }
  });

  clipInterval = setInterval(() => {
    if (!clipEnabled) return;
    try {
      const text = clipboard.readText();
      if (text !== agentLastClip && text.length > 0 && text.length < 100000) {
        agentLastClip = text;
        agentServer?.broadcastClipboard(text);
      }
    } catch {}
  }, 1000);

  Input.setFocusCallback((x, y, w, h) => {
    agentServer?.broadcastWindowFocus(x, y, w, h);
  });

  agentServer.start();
  agentDiscovery.start();
  createTray();
  log.info('Modo agent iniciado');
}

function stopAgentMode() {
  pendingRequests.clear(); pendingReqCounter = 0;
  clearInterval(clipInterval); clipInterval = null;
  captureRetries = 0;
  require('./input').shutdown();
  agentServer?.stop();    agentServer = null;
  agentDiscovery?.stop(); agentDiscovery = null;
  captureWin?.destroy();  captureWin = null;
  agentUIWin?.destroy();  agentUIWin = null;
  closeAgentChatWin();
  agentLastClip = ''; agentPassword = ''; clipEnabled = false;
  destroyTray();
  log.info('Modo agent parado');
}

// ── Viewer mode ───────────────────────────────────────────────────────────────
function startViewerMode() {
  if (viewerWin) return;
  const ViewerDiscovery = require('./viewer-discovery');

  viewerWin = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500,
    title: 'Remote Acesso', backgroundColor: '#0f0f1a',
    webPreferences: { preload: src('preload-viewer.js'), contextIsolation: true },
  });
  viewerWin.setMenuBarVisibility(false);
  viewerWin.loadFile(src('viewer.html'));
  viewerWin.on('closed',            () => { stopViewerMode(); viewerWin = null; openLauncher(); });
  viewerWin.on('enter-full-screen', () => viewerWin?.webContents.send('fullscreen-change', true));
  viewerWin.on('leave-full-screen', () => { _maxToFs = false; viewerWin?.webContents.send('fullscreen-change', false); });
  viewerWin.on('maximize', () => {
    if (loadSettings().hideTaskbarMaximized) { _maxToFs = true; viewerWin.setFullScreen(true); }
  });
  viewerWin.on('unmaximize', () => {
    if (_maxToFs) { _maxToFs = false; viewerWin.setFullScreen(false); }
  });
  viewerWin.on('focus', () => {
    if (vAuthed && loadSettings().transmitHotkeys) require('./win-key-hook').startHook(key => {
      if (!vAuthed || !key) return;
      if (key.vk === 0x5B || key.vk === 0x5C)
        vSend({ type: MSG.KEY, code: key.vk === 0x5B ? 'MetaLeft' : 'MetaRight', key: 'Meta', down: key.down });
    });
  });
  viewerWin.on('blur',  () => require('./win-key-hook').stopHook());

  vDiscovery = new ViewerDiscovery();
  vDiscovery.on('agent', agent => viewerWin?.webContents.send('agent-found', agent));
  vDiscovery.start();

  viewerWin.webContents.on('did-finish-load', () => {
    for (const agent of vDiscovery.agents.values())
      viewerWin.webContents.send('agent-found', agent);
  });
}

function stopViewerMode() {
  vIntentional = true; _maxToFs = false;
  clearTimeout(vReconnTimer);
  vAuthed = false; vEncKey = null;
  require('./win-key-hook').stopHook();
  vWs?.close(); vWs = null;
  vDiscovery?.stop(); vDiscovery = null;
  viewerWin?.destroy(); viewerWin = null;
  closeChatWin();
  vLastOpts = null; vReconnCount = 0;
}

// ── Viewer WebSocket (encrypted) ──────────────────────────────────────────────
function vDoConnect({ host, port, password, requestAccess }) {
  return new Promise(resolve => {
    if (vWs) { vWs.close(); vWs = null; vAuthed = false; vEncKey = null; }

    const newWs = new WebSocket(`ws://${host}:${port}`);
    newWs.binaryType = 'nodebuffer';
    vWs = newWs;

    let resolved = false; // whether the connect Promise has been resolved
    let localKey = null;

    function safeResolve(result) {
      if (!resolved) { resolved = true; resolve(result); }
    }

    newWs.on('open', () => {});

    newWs.on('message', data => {
      if (!Buffer.isBuffer(data)) return;

      // Phase 1: key exchange
      if (!localKey) {
        const serverPubKey = parseKexMessage(data);
        if (!serverPubKey) {
          safeResolve({ ok: false, error: 'Erro de protocolo' });
          vWs?.close(); vWs = null;
          return;
        }
        const ecdh = createECDH();
        try {
          localKey = deriveKey(ecdh, serverPubKey);
          vEncKey  = localKey;
        } catch {
          safeResolve({ ok: false, error: 'Falha na criptografia' });
          vWs?.close(); vWs = null;
          return;
        }
        newWs.send(makeKexMessage(ecdh));

        if (requestAccess) {
          // Send access request instead of auth — resolve immediately so viewer
          // can show the "waiting for agent approval" UI without blocking.
          const plain = Buffer.concat([
            Buffer.from([0x00]),
            Buffer.from(JSON.stringify({ type: MSG.ACCESS_REQUEST })),
          ]);
          newWs.send(encrypt(localKey, plain));
          safeResolve({ ok: true, pending: true });
        } else {
          const authPlain = Buffer.concat([
            Buffer.from([0x00]),
            Buffer.from(JSON.stringify({ type: MSG.AUTH, password })),
          ]);
          newWs.send(encrypt(localKey, authPlain));
        }
        return;
      }

      // Decrypt all subsequent messages
      let plain;
      try { plain = decrypt(localKey, data); }
      catch { return; }

      if (!resolved) {
        // Normal auth response (only reached when requestAccess is false)
        resolved = true;
        if (!Buffer.isBuffer(plain) || plain[0] !== 0x00) {
          resolve({ ok: false, error: 'Resposta invalida' });
          vWs?.close(); vWs = null; return;
        }
        let msg;
        try { msg = JSON.parse(plain.slice(1).toString()); } catch {
          resolve({ ok: false, error: 'Resposta invalida' });
          vWs?.close(); vWs = null; return;
        }
        if (msg.type === MSG.AUTH_OK) {
          vAuthed = true; vReconnCount = 0;
          if (viewerWin?.isFocused() && loadSettings().transmitHotkeys) require('./win-key-hook').startHook();
          viewerWin?.webContents.send('display-settings', loadSettings().display || DEFAULT_DISPLAY);
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: 'Senha incorreta' });
          vWs?.close(); vWs = null;
        }
        return;
      }

      // All post-auth messages (including ACCESS_ACCEPTED / ACCESS_REJECTED)
      vHandleMessage(plain);
    });

    newWs.on('close', () => {
      vEncKey = null;
      const wasAuthed = vAuthed;
      safeResolve({ ok: false, error: 'Conexao recusada' });
      vAuthed = false; vWs = null;
      if (wasAuthed) chatLogFile = null;
      require('./win-key-hook').stopHook();
      if (requestAccess && !wasAuthed && !vIntentional) {
        // Connection closed while waiting for agent response
        viewerWin?.webContents.send('access-rejected');
      } else if (wasAuthed && !vIntentional) {
        viewerWin?.webContents.send('disconnected');
        if (vLastOpts) vScheduleReconnect();
      }
    });

    newWs.on('error', err => {
      safeResolve({ ok: false, error: err.message });
      vWs = null; vAuthed = false; vEncKey = null;
    });
  });
}

function vScheduleReconnect() {
  vReconnCount++;
  if (vReconnCount > MAX_RECONN) {
    vReconnCount = 0;
    viewerWin?.webContents.send('reconnect-failed');
    return;
  }
  viewerWin?.webContents.send('reconnecting', vReconnCount, MAX_RECONN);
  vReconnTimer = setTimeout(async () => {
    if (!vLastOpts || vIntentional) return;
    await vDoConnect(vLastOpts);
  }, 3000);
}

function vSend(msg) {
  if (vWs?.readyState !== WebSocket.OPEN || !vAuthed || !vEncKey) return;
  const plain = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from(JSON.stringify(msg)),
  ]);
  vWs.send(encrypt(vEncKey, plain));
}

function vHandleMessage(plain) {
  if (!Buffer.isBuffer(plain)) return;

  if (plain[0] === 0x01) {
    const w = plain.readUInt32LE(1), h = plain.readUInt32LE(5);
    viewerWin?.webContents.send('frame', plain.slice(9), w, h);
  } else if (plain[0] === 0x00) {
    let msg; try { msg = JSON.parse(plain.slice(1).toString()); } catch { return; }
    switch (msg.type) {
      case MSG.MONITOR_LIST:
        viewerWin?.webContents.send('monitor-list', msg.monitors); break;
      case MSG.CHAT: {
        const _text = msg.text;
        appendChatLog('Agente', _text);
        const _title = vLastOpts?.host ? `Chat — ${vLastOpts.host}` : 'Chat';
        if (!chatWin || chatWin.isDestroyed()) {
          chatWin = createChatWindow(_title);
          chatWin.on('closed', () => { chatWin = null; });
          chatWin.webContents.once('did-finish-load', () =>
            chatWin?.webContents.send('chat-message', { from: 'Agente', text: _text }));
        } else {
          chatWin.focus();
          chatWin.webContents.send('chat-message', { from: 'Agente', text: _text });
        }
        viewerWin?.webContents.send('chat', _text);
        break;
      }
      case MSG.CLIPBOARD:
        if (msg.text) { clipboard.writeText(msg.text); viewerWin?.webContents.send('clipboard-synced'); }
        break;
      case MSG.ACCESS_ACCEPTED:
        vAuthed = true; vReconnCount = 0;
        if (viewerWin?.isFocused() && loadSettings().transmitHotkeys)
          require('./win-key-hook').startHook(key => {
            if (!vAuthed || !key) return;
            if (key.vk === 0x5B || key.vk === 0x5C)
              vSend({ type: MSG.KEY, code: key.vk === 0x5B ? 'MetaLeft' : 'MetaRight', key: 'Meta', down: key.down });
          });
        viewerWin?.webContents.send('access-accepted');
        viewerWin?.webContents.send('display-settings', loadSettings().display || DEFAULT_DISPLAY);
        break;
      case MSG.ACCESS_REJECTED:
        viewerWin?.webContents.send('access-rejected');
        vWs?.close(); vWs = null;
        break;
      case MSG.WINDOW_FOCUS:
        viewerWin?.webContents.send('window-focus', { x: msg.x, y: msg.y, w: msg.w, h: msg.h });
        break;
      case MSG.FILE_START:
        vInFile = { name: msg.name, size: msg.size }; vInChunks = [];
        if (msg.size > MAX_FILE_SIZE) {
          log.warn('Arquivo de entrada muito grande', { name: msg.name, sizeMB: Math.round(msg.size/1024/1024) });
          vInFile = null;
          return;
        }
        viewerWin?.webContents.send('file-incoming', { name: msg.name, size: msg.size }); break;
      case MSG.FILE_CHUNK:
        if (vInFile) vInChunks.push(Buffer.from(msg.data, 'base64')); break;
      case MSG.FILE_END:
        if (!vInFile) break;
        (async () => {
          const full = Buffer.concat(vInChunks);
          const { canceled, filePath } = await dialog.showSaveDialog(viewerWin, {
            defaultPath: vInFile.name, title: 'Salvar arquivo recebido',
          });
          if (!canceled && filePath) {
            fs.writeFileSync(filePath, full);
            viewerWin?.webContents.send('file-saved', filePath);
          }
        })();
        vInFile = null; vInChunks = []; break;
    }
  }
}

// ── Single-instance lock ──────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => { launcherWin?.show(); launcherWin?.focus(); });

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (app.isPackaged) {
    try {
      await ensureFirewallRules();
    } catch (e) {
      log.error('Falha ao configurar firewall', { error: e.message });
      dialog.showMessageBoxSync({
        type:    'warning',
        title:   'Aviso de Firewall',
        message: 'Nao foi possivel configurar as regras de firewall automaticamente.\n\nO Remote Acesso pode nao funcionar corretamente em redes com firewall ativo.\n\nPermita o acesso manualmente nas configuracoes do Windows Defender.',
        buttons: ['OK'],
      });
    }
  }

  if (app.isPackaged) {
    const { setupUpdater, checkForUpdates } = require('./updater');
    setupUpdater({
      checking:     () => launcherWin?.webContents.send('update-status', 'checking'),
      available:    () => launcherWin?.webContents.send('update-status', 'downloading'),
      notAvailable: () => launcherWin?.webContents.send('update-status', 'latest'),
      progress:     p  => launcherWin?.webContents.send('update-progress', Math.round(p.percent)),
      downloaded:   () => launcherWin?.webContents.send('update-status', 'ready'),
      error:        () => launcherWin?.webContents.send('update-status', 'error'),
    });
    checkForUpdates();
  }

  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) =>
    cb(perm === 'media'));

  openLauncher();
  _appReady = true;

  // Start the new mode BEFORE destroying the launcher so there is never a
  // window-less moment that triggers window-all-closed → app.quit().
  ipcMain.on('launch-agent',  () => { startAgentMode();  launcherWin?.destroy(); launcherWin = null; });
  ipcMain.on('launch-viewer', () => { startViewerMode(); launcherWin?.destroy(); launcherWin = null; });
  ipcMain.on('install-update', () => { if (app.isPackaged) require('./updater').installUpdate(); });
  ipcMain.on('open-settings',  () => openSettings());

  ipcMain.on    ('get-theme',              event     => { event.returnValue = loadSettings().theme || 'system'; });
  ipcMain.handle('settings-load',          ()        => loadSettings());
  ipcMain.handle('settings-save',          (_, data) => saveSettings(data));
  ipcMain.handle('settings-get-defaults',  ()        => ({
    screenshotPath:  path.join(os.homedir(), 'Pictures', 'RemoteAcesso'),
    chatHistoryPath: path.join(app.getPath('userData'), 'chat'),
  }));
  ipcMain.handle('settings-browse-folder', async () => {
    const parent = settingsWin || launcherWin;
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      properties: ['openDirectory'], title: 'Selecionar pasta',
    });
    return canceled ? null : filePaths[0];
  });

  // Display settings
  ipcMain.handle('get-display-settings', () => loadSettings().display || DEFAULT_DISPLAY);

  ipcMain.handle('settings-load-display', () => loadSettings().display || DEFAULT_DISPLAY);

  ipcMain.handle('settings-save-display', (_, data) => {
    const s  = loadSettings();
    s.display = { ...DEFAULT_DISPLAY, ...data };
    _settings = s;
    try {
      const p = path.join(app.getPath('userData'), 'settings.json');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf8');
    } catch (e) { log.error('Falha ao salvar configuracoes de exibicao', { error: e.message }); }
    viewerWin?.webContents.send('display-settings', s.display);
    const preset = QUALITY_PRESETS[s.display.quality] || QUALITY_PRESETS.balanced;
    if (vAuthed) vSend({ type: MSG.QUALITY, ...preset });
    captureWin?.webContents.send('set-capture-quality', preset);
    return s.display;
  });

  ipcMain.handle('get-device-display-settings', (_, hostname) => {
    const s = loadSettings();
    return (s.perDevice?.[hostname]?.display) || null;
  });

  ipcMain.on('save-device-display-settings', (_, { hostname, display }) => {
    const s = loadSettings();
    if (!s.perDevice) s.perDevice = {};
    if (!s.perDevice[hostname]) s.perDevice[hostname] = {};
    s.perDevice[hostname].display = { ...DEFAULT_DISPLAY, ...display };
    _settings = s;
    try {
      const p = path.join(app.getPath('userData'), 'settings.json');
      fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf8');
    } catch (e) { log.error('Falha ao salvar config por dispositivo', { error: e.message }); }
  });

  ipcMain.on('set-viewer-quality', (_, preset) => {
    const params = QUALITY_PRESETS[preset] || QUALITY_PRESETS.balanced;
    vSend({ type: MSG.QUALITY, ...params });
  });

  // Capture (agent mode)
  ipcMain.handle('get-sources', async () => {
    const { screen } = require('electron');
    const sources  = await desktopCapturer.getSources({ types: ['screen'] });
    const displays = screen.getAllDisplays();
    return sources.map((s, i) => {
      const displayId = parseInt(s.display_id);
      const display   = (displayId && screen.getDisplayById?.(displayId)) || displays[i] || screen.getPrimaryDisplay();
      return { id: s.id, name: s.name, index: i, width: display.bounds.width, height: display.bounds.height };
    });
  });

  ipcMain.on('frame',        (_, buf, w, h) => agentServer?.broadcastFrame(Buffer.from(buf), w, h));
  ipcMain.on('capture-error', (_, msg) => {
    log.error('Falha na captura de tela', { error: msg });
    agentUIWin?.webContents.send('ui-capture-error', msg);
    captureWin?.destroy();
  });
  ipcMain.on('monitor-list', (_, monitors)  => {
    captureRetries = 0;
    agentServer?.setMonitorList(monitors);
    agentServer?.broadcastMonitorList(monitors);
    if (monitors[0]) require('./input').setScreenBounds(monitors[0].width, monitors[0].height);
  });

  // Agent UI
  ipcMain.on('ui-copy-password',    () => { if (agentPassword) clipboard.writeText(agentPassword); });
  ipcMain.on('ui-minimize',         () => { agentUIWin?.hide(); });
  ipcMain.on('ui-close',            () => { agentUIWin?.hide(); });
  ipcMain.on('ui-toggle-clipboard', (_, enabled) => { clipEnabled = !!enabled; });

  // Agent password mode
  ipcMain.on('agent-set-password', (_, { mode, pwd }) => {
    const s = loadSettings();
    s.agentPasswordMode    = mode;
    s.agentFixedPassword   = pwd || '';
    _settings = s;
    try {
      fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(s, null, 2), 'utf8');
    } catch {}
    if (mode === 'fixed' && pwd && pwd.length >= 4) {
      agentPassword = pwd;
    }
    if (agentServer) agentServer.password = agentPassword;
    agentUIWin?.webContents.send('ui-new-password', agentPassword);
  });

  ipcMain.on('agent-regen-password', () => {
    const s = loadSettings();
    agentPassword = generatePassword();
    s.agentPasswordMode  = 'random';
    s.agentFixedPassword = '';
    _settings = s;
    try {
      fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(s, null, 2), 'utf8');
    } catch {}
    if (agentServer) agentServer.password = agentPassword;
    agentUIWin?.webContents.send('ui-new-password', agentPassword);
  });

  // Agent access request accept/reject
  ipcMain.on('agent-accept-request', (_, id) => {
    const ws = pendingRequests.get(id);
    if (ws) { pendingRequests.delete(id); agentServer?.acceptPending(ws); }
    agentUIWin?.flashFrame(false);
  });

  ipcMain.on('agent-reject-request', (_, id) => {
    const ws = pendingRequests.get(id);
    if (ws) { pendingRequests.delete(id); agentServer?.rejectPending(ws); }
    agentUIWin?.flashFrame(false);
  });

  ipcMain.handle('get-version', () => app.getVersion());

  // Viewer connect/disconnect
  ipcMain.handle('connect', (_, opts) => {
    clearTimeout(vReconnTimer); vReconnCount = 0;
    vIntentional = false; vLastOpts = opts;
    return vDoConnect(opts);
  });
  ipcMain.on('disconnect', () => {
    vIntentional = true; vReconnCount = 0;
    clearTimeout(vReconnTimer);
    vAuthed = false; vEncKey = null; vWs?.close(); vWs = null;
  });

  // Viewer interaction
  ipcMain.on('input', (_, msg)  => vSend(msg));

  ipcMain.on('chat', (_, text) => {
    appendChatLog('Eu', text);
    vSend({ type: MSG.CHAT, text });
    const _title = vLastOpts?.host ? `Chat — ${vLastOpts.host}` : 'Chat';
    if (!chatWin || chatWin.isDestroyed()) {
      chatWin = createChatWindow(_title);
      chatWin.on('closed', () => { chatWin = null; });
      chatWin.webContents.once('did-finish-load', () =>
        chatWin?.webContents.send('chat-message', { from: 'Eu', text }));
    } else {
      chatWin.webContents.send('chat-message', { from: 'Eu', text });
    }
  });

  ipcMain.on('open-chat-window', (_, agentName) => {
    if (chatWin && !chatWin.isDestroyed()) { chatWin.focus(); return; }
    chatWin = createChatWindow(agentName ? `Chat — ${agentName}` : 'Chat');
    chatWin.on('closed', () => { chatWin = null; });
  });

  ipcMain.on('chat-send', (event, text) => {
    if (chatWin && !chatWin.isDestroyed() && event.sender === chatWin.webContents) {
      appendChatLog('Eu', text);
      vSend({ type: MSG.CHAT, text });
    } else if (agentChatWin && !agentChatWin.isDestroyed() && event.sender === agentChatWin.webContents) {
      appendChatLog('Eu', text);
      agentServer?.broadcastChat(text);
    }
  });
  ipcMain.on('monitor-switch', (_, idx)  => vSend({ type: MSG.MONITOR_SWITCH, index: idx }));
  ipcMain.on('push-clipboard', () => {
    const t = clipboard.readText();
    if (t) vSend({ type: MSG.CLIPBOARD, text: t });
  });

  ipcMain.on('toggle-fullscreen', (_, mode) => {
    if (!viewerWin) return;
    if (mode === 'windowed') {
      viewerWin.isMaximized() ? viewerWin.unmaximize() : viewerWin.maximize();
    } else {
      viewerWin.setFullScreen(!viewerWin.isFullScreen());
    }
  });

  // Screenshot (viewer captures canvas → saves locally)
  ipcMain.handle('take-screenshot', (_, dataUrl) => {
    const s   = loadSettings();
    const dir = s.screenshotDir === 'custom' && s.screenshotCustomPath
      ? s.screenshotCustomPath
      : path.join(os.homedir(), 'Pictures', 'RemoteAcesso');
    fs.mkdirSync(dir, { recursive: true });
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, `screenshot-${ts}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    return file;
  });

  // File send (viewer → agent)
  ipcMain.handle('send-file', async () => {
    if (!viewerWin) return;
    const { canceled, filePaths } = await dialog.showOpenDialog(viewerWin, {
      properties: ['openFile'], title: 'Selecionar arquivo para enviar',
    });
    if (canceled || !filePaths.length) return;
    const filePath = filePaths[0];
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      dialog.showMessageBoxSync(viewerWin, {
        type: 'warning', title: 'Arquivo muito grande',
        message: `O arquivo excede o limite de ${Math.round(MAX_FILE_SIZE/1024/1024)} MB.`,
        buttons: ['OK'],
      });
      return;
    }
    const name = path.basename(filePath);
    const size = stat.size;
    vSend({ type: MSG.FILE_START, name, size });
    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(FILE_CHUNK_SIZE);
    let offset = 0;
    while (offset < size) {
      const n = fs.readSync(fd, buf, 0, FILE_CHUNK_SIZE, offset);
      vSend({ type: MSG.FILE_CHUNK, data: buf.slice(0, n).toString('base64') });
      offset += n;
      viewerWin?.webContents.send('file-progress', { sent: offset, total: size });
    }
    fs.closeSync(fd);
    vSend({ type: MSG.FILE_END });
  });
});

app.on('window-all-closed', () => {
  // Guard: only act after the launcher window has been created.
  // Without this, window-all-closed can fire during Electron's internal
  // initialization (before openLauncher runs) and quit the app instantly.
  if (!_appReady) return;
  // Agent mode lives in the system tray — don't quit while tray is active.
  if (!tray) app.quit();
});

app.on('before-quit', () => {
  _appReady = false; // prevent window-all-closed re-entry during cleanup
  // Release external resources that keep the Node event loop alive.
  // Do NOT call stopAgentMode/stopViewerMode here — they destroy BrowserWindows
  // that Electron is already handling in its own quit sequence.
  clearInterval(clipInterval); clipInterval = null;
  try { agentServer?.stop(); }    catch {} agentServer = null;
  try { agentDiscovery?.stop(); } catch {} agentDiscovery = null;
  vIntentional = true;
  clearTimeout(vReconnTimer);
  try { vWs?.close(); } catch {} vWs = null;
  try { vDiscovery?.stop(); } catch {} vDiscovery = null;
  try { require('./input').shutdown(); } catch {}
  require('./win-key-hook').stopHook();
  // Safety net: force-exit after 3 s if any handle keeps Node alive.
  setTimeout(() => process.exit(0), 3000).unref();
});
