// ── State ─────────────────────────────────────────────────────────────────────
let connected = false;
let currentAgent = null;
let pendingAuthAgent = null;
let pendingAuthLi = null;
let chatWindowOpened = false;

// ── Display settings ──────────────────────────────────────────────────────────
let dSettings = {
  quality: 'balanced', cursorMode: 'auto', followCursor: false,
  viewMode: 'fit', startFullscreen: false, fullscreenMode: 'exclusive',
  perDeviceSettings: 'global',
};
let mouseOverCanvas = false;

function applyDisplaySettings(ds) {
  dSettings = { ...dSettings, ...ds };
  const wrapper = document.getElementById('screen-wrapper');
  wrapper.classList.remove('view-original', 'view-fit', 'view-stretch');
  wrapper.classList.add('view-' + (dSettings.viewMode || 'fit'));
}

window.electronAPI.getDisplaySettings().then(ds => {
  if (ds) applyDisplaySettings(ds);
}).catch(() => {});

window.electronAPI.onDisplaySettings(ds => {
  applyDisplaySettings(ds);
  if (connected) window.electronAPI.setQuality(dSettings.quality || 'balanced');
});

function ensureChatOpen() {
  if (chatWindowOpened) return;
  chatWindowOpened = true;
  window.electronAPI.openChatWindow(currentAgent?.hostname);
}

const canvas = document.getElementById('screen-canvas');
const ctx = canvas.getContext('2d');
let frameWidth = 1920, frameHeight = 1080;

// ── DOM refs ───────────────────────────────────────────────────────────────────
const agentList      = document.getElementById('agent-list');
const monitorPanel   = document.getElementById('monitor-panel');
const monitorSelect  = document.getElementById('monitor-select');
const toolsPanel     = document.getElementById('tools-panel');
const filePanel      = document.getElementById('file-panel');
const chatPanel      = document.getElementById('chat-panel');
const chatMessages   = document.getElementById('chat-messages');
const chatInput      = document.getElementById('chat-input');
const fileStatus     = document.getElementById('file-status');
const clipboardStatus= document.getElementById('clipboard-status');
const overlay        = document.getElementById('overlay');
const overlayText    = document.getElementById('overlay-text');
const statusDot      = document.getElementById('status-dot');
const statusText     = document.getElementById('status-text');
const authModal      = document.getElementById('auth-modal');

// ── Discovery ─────────────────────────────────────────────────────────────────
const knownAgents = new Map();

window.electronAPI.onAgentFound(agent => {
  const key = `${agent.host}:${agent.port}`;
  if (knownAgents.has(key)) return;
  knownAgents.set(key, agent);

  const empty = agentList.querySelector('.empty-hint');
  if (empty) empty.remove();

  const li = document.createElement('li');
  li.className = 'agent-item';
  li.dataset.key = key;
  li.innerHTML = `<div class="agent-name">${escHtml(agent.hostname)}</div><div class="agent-addr">${agent.host}</div>`;
  li.addEventListener('click', () => showAuthModal(agent, li));
  agentList.appendChild(li);
});

// ── Auth Modal ────────────────────────────────────────────────────────────────
function showAuthModal(agent, li) {
  document.getElementById('auth-agent-name').textContent = `${agent.hostname}  ·  ${agent.host}`;
  document.getElementById('auth-input').value = '';
  document.getElementById('auth-error').classList.add('hidden');
  authModal.classList.remove('hidden');
  document.getElementById('auth-input').focus();
  pendingAuthAgent = agent;
  pendingAuthLi    = li;
}

document.getElementById('btn-auth-cancel').addEventListener('click', () => {
  authModal.classList.add('hidden');
  pendingAuthAgent = null; pendingAuthLi = null;
});

document.getElementById('auth-input').addEventListener('keydown', e => {
  if (e.key === 'Enter')  submitAuth();
  if (e.key === 'Escape') document.getElementById('btn-auth-cancel').click();
});

document.getElementById('btn-auth-connect').addEventListener('click', submitAuth);
document.getElementById('btn-auth-request').addEventListener('click', submitAccessRequest);

async function submitAccessRequest() {
  const agent = pendingAuthAgent;
  const li    = pendingAuthLi;
  if (!agent) return;

  const btn = document.getElementById('btn-auth-request');
  btn.disabled = true; btn.textContent = 'Aguardando...';

  if (connected) { window.electronAPI.disconnect(); setDisconnected(); }
  setStatus('Solicitando acesso...', false);

  const result = await window.electronAPI.connect({ host: agent.host, port: agent.port, requestAccess: true });

  btn.disabled = false; btn.textContent = 'Solicitar Acesso';

  if (!result.ok && !result.pending) {
    const err = document.getElementById('auth-error');
    err.textContent = result.error || 'Erro de conexão';
    err.classList.remove('hidden');
    setStatus('Desconectado', false);
    return;
  }

  currentAgent = agent;
  li?.classList.add('active');
  authModal.classList.add('hidden');
  pendingAuthAgent = null; pendingAuthLi = null;

  overlay.classList.remove('hidden');
  overlayText.textContent = 'Aguardando aprovação do agente...';
  setStatus('Aguardando aprovação...', false);
}

window.electronAPI.onAccessAccepted(() => {
  connected = true;
  overlay.classList.add('hidden');
  toolsPanel.style.display = '';
  filePanel.style.display  = '';
  chatPanel.style.display  = '';
  if (currentAgent)
    setStatus(`${currentAgent.hostname} (${currentAgent.host})`, true);

  (async () => {
    let ds = dSettings;
    if (dSettings.perDeviceSettings === 'perDevice' && currentAgent) {
      const deviceDs = await window.electronAPI.getDeviceDisplaySettings(currentAgent.hostname).catch(() => null);
      if (deviceDs) ds = { ...dSettings, ...deviceDs };
    }
    applyDisplaySettings(ds);
    window.electronAPI.setQuality(ds.quality || 'balanced');
    if (ds.startFullscreen && !document.body.classList.contains('fullscreen'))
      window.electronAPI.toggleFullscreen(ds.fullscreenMode || 'exclusive');
  })();
});

window.electronAPI.onAccessRejected(() => {
  connected = false;
  document.querySelectorAll('.agent-item').forEach(el => el.classList.remove('active'));
  currentAgent = null;
  overlay.classList.remove('hidden');
  overlayText.textContent = 'Acesso recusado pelo agente.';
  setStatus('Desconectado', false);
  setTimeout(() => {
    if (!connected) overlayText.textContent = 'Selecione um agente para conectar';
  }, 3000);
});

async function submitAuth() {
  const password = document.getElementById('auth-input').value;
  if (!password) return;

  const btn = document.getElementById('btn-auth-connect');
  btn.disabled = true; btn.textContent = 'Conectando...';

  const agent = pendingAuthAgent;
  const li    = pendingAuthLi;

  if (connected) { window.electronAPI.disconnect(); setDisconnected(); }
  setStatus('Conectando...', false);

  const result = await window.electronAPI.connect({ host: agent.host, port: agent.port, password });

  btn.disabled = false; btn.textContent = 'Conectar';

  if (!result.ok) {
    const err = document.getElementById('auth-error');
    err.textContent = result.error || 'Erro de conexão';
    err.classList.remove('hidden');
    setStatus('Desconectado', false);
    return;
  }

  authModal.classList.add('hidden');
  pendingAuthAgent = null; pendingAuthLi = null;
  currentAgent = agent; connected = true;

  document.querySelectorAll('.agent-item').forEach(el => el.classList.remove('active'));
  li?.classList.add('active');

  overlay.classList.add('hidden');
  toolsPanel.style.display = '';
  filePanel.style.display  = '';
  chatPanel.style.display  = '';
  setStatus(`${agent.hostname} (${agent.host})`, true);

  // Load per-device or global display settings, then apply quality to agent
  (async () => {
    let ds = dSettings;
    if (dSettings.perDeviceSettings === 'perDevice') {
      const deviceDs = await window.electronAPI.getDeviceDisplaySettings(agent.hostname).catch(() => null);
      if (deviceDs) ds = { ...dSettings, ...deviceDs };
    }
    applyDisplaySettings(ds);
    window.electronAPI.setQuality(ds.quality || 'balanced');
    if (ds.startFullscreen && !document.body.classList.contains('fullscreen'))
      window.electronAPI.toggleFullscreen(ds.fullscreenMode || 'exclusive');
  })();
}

// ── Disconnect ────────────────────────────────────────────────────────────────
window.electronAPI.onDisconnected(() => {
  connected = false;
  overlay.classList.remove('hidden');
  overlayText.textContent = 'Conexão perdida. Reconectando...';
  setStatus('Desconectado', false);
});

window.electronAPI.onReconnecting((attempt, max) => {
  overlayText.textContent = `Reconectando... (${attempt}/${max})`;
  setStatus(`Reconectando... ${attempt}/${max}`, false);
});

window.electronAPI.onReconnectFailed(() => setDisconnected());

function setDisconnected() {
  connected = false; currentAgent = null;
  chatWindowOpened = false;
  clearCursor();
  overlay.classList.remove('hidden');
  overlayText.textContent = 'Selecione um agente para conectar';
  monitorPanel.style.display = 'none';
  toolsPanel.style.display   = 'none';
  filePanel.style.display    = 'none';
  chatPanel.style.display    = 'none';
  document.querySelectorAll('.agent-item').forEach(el => el.classList.remove('active'));
  setStatus('Desconectado', false);
}

function setStatus(text, online) {
  statusText.textContent = text;
  statusDot.className = 'dot ' + (online ? 'dot-on' : 'dot-off');
}

// ── Cursor overlay ────────────────────────────────────────────────────────────
const cursorCanvas = document.createElement('canvas');
cursorCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
canvas.parentElement.insertBefore(cursorCanvas, canvas.nextSibling);
const cursorCtx = cursorCanvas.getContext('2d');
let cursorX = 0, cursorY = 0;

canvas.addEventListener('mouseenter', () => { mouseOverCanvas = true; });
canvas.addEventListener('mouseleave', () => { mouseOverCanvas = false; });

function syncCursorCanvas() {
  if (cursorCanvas.width !== canvas.width)   cursorCanvas.width  = canvas.width;
  if (cursorCanvas.height !== canvas.height) cursorCanvas.height = canvas.height;
}

function drawCursor() {
  syncCursorCanvas();
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  const x = cursorX, y = cursorY;
  // Scale so the arrow appears ~20px on screen regardless of remote resolution
  const r = canvas.getBoundingClientRect();
  const s = (r.width > 0 ? cursorCanvas.width / r.width : 1) * 20;
  cursorCtx.save();
  cursorCtx.beginPath();
  cursorCtx.moveTo(x,              y);              // tip
  cursorCtx.lineTo(x,              y + s * 0.85);   // bottom-left edge
  cursorCtx.lineTo(x + s * 0.30,   y + s * 0.62);   // inner notch left
  cursorCtx.lineTo(x + s * 0.50,   y + s * 1.00);   // tail bottom
  cursorCtx.lineTo(x + s * 0.65,   y + s * 0.94);   // tail right
  cursorCtx.lineTo(x + s * 0.45,   y + s * 0.58);   // inner notch right
  cursorCtx.lineTo(x + s * 0.72,   y + s * 0.58);   // horizontal tip
  cursorCtx.closePath();
  cursorCtx.fillStyle   = '#d32f2f';
  cursorCtx.fill();
  cursorCtx.strokeStyle = '#ffffff';
  cursorCtx.lineWidth   = Math.max(1, s * 0.07);
  cursorCtx.stroke();
  cursorCtx.restore();
}

function clearCursor() {
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
}

function scrollToArea(x, y, w, h) {
  const wrapper = document.getElementById('screen-wrapper');
  if (!wrapper.classList.contains('view-original')) return;
  const vw = wrapper.clientWidth, vh = wrapper.clientHeight;
  wrapper.scrollLeft = Math.max(0, x + w / 2 - vw / 2);
  wrapper.scrollTop  = Math.max(0, y + h / 2 - vh / 2);
}

window.electronAPI.onWindowFocus(rect => {
  if (!dSettings.followWindowFocus || !connected) return;
  scrollToArea(rect.x, rect.y, rect.w, rect.h);
});

function followCursor() {
  const wrapper = document.getElementById('screen-wrapper');
  if (!wrapper.classList.contains('view-original')) return;
  const vw = wrapper.clientWidth,  vh = wrapper.clientHeight;
  const sl = wrapper.scrollLeft,   st = wrapper.scrollTop;
  const margin = 60;
  let newSl = sl, newSt = st;
  if (cursorX < sl + margin)      newSl = cursorX - margin;
  if (cursorX > sl + vw - margin) newSl = cursorX - vw + margin;
  if (cursorY < st + margin)      newSt = cursorY - margin;
  if (cursorY > st + vh - margin) newSt = cursorY - vh + margin;
  if (newSl !== sl) wrapper.scrollLeft = Math.max(0, newSl);
  if (newSt !== st) wrapper.scrollTop  = Math.max(0, newSt);
}

function applyEdgePan() {
  if (!dSettings.edgePanning || panClientX < 0 || !connected) return;
  const wrapper = document.getElementById('screen-wrapper');
  if (!wrapper.classList.contains('view-original')) return;
  const wr = wrapper.getBoundingClientRect();
  const mx = panClientX - wr.left;
  const my = panClientY - wr.top;
  const vw = wr.width, vh = wr.height;
  const ZONE = 60, MAX_SPEED = 15;
  let dx = 0, dy = 0;
  if (mx < ZONE)       dx = -(1 - mx / ZONE)        * MAX_SPEED;
  if (mx > vw - ZONE)  dx =  (1 - (vw - mx) / ZONE) * MAX_SPEED;
  if (my < ZONE)       dy = -(1 - my / ZONE)        * MAX_SPEED;
  if (my > vh - ZONE)  dy =  (1 - (vh - my) / ZONE) * MAX_SPEED;
  if (dx !== 0) wrapper.scrollLeft = Math.max(0, wrapper.scrollLeft + dx);
  if (dy !== 0) wrapper.scrollTop  = Math.max(0, wrapper.scrollTop  + dy);
  if (dx !== 0 || dy !== 0) scheduleRaf();
}

// ── Screen frames — RAF pipeline ──────────────────────────────────────────────
let pendingBitmap  = null;
let rafScheduled   = false;
let pendingWidth   = 0;
let pendingHeight  = 0;

// Mouse move is flushed through RAF to cap sends at display refresh rate (~60fps)
let pendingMouseMove = false;
let pendingMx = 0, pendingMy = 0;

// Edge panning — raw client coords of cursor (-1 when outside canvas)
let panClientX = -1, panClientY = -1;

function scheduleRaf() {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(renderFrame);
}

function renderFrame() {
  rafScheduled = false;
  if (pendingMouseMove && connected) {
    window.electronAPI.sendInput({ type: 'mouse_move', nx: pendingMx, ny: pendingMy });
    pendingMouseMove = false;
  }
  if (pendingBitmap) {
    if (canvas.width  !== pendingWidth)  canvas.width  = pendingWidth;
    if (canvas.height !== pendingHeight) canvas.height = pendingHeight;
    ctx.drawImage(pendingBitmap, 0, 0);
    pendingBitmap.close();
    pendingBitmap  = null;
  }
  const showCursor = dSettings.cursorMode === 'on' ||
    (dSettings.cursorMode === 'auto' && mouseOverCanvas && connected);
  if (showCursor) drawCursor(); else clearCursor();
  applyEdgePan();
}

window.electronAPI.onFrame((jpeg, w, h) => {
  frameWidth = w; frameHeight = h;
  pendingWidth  = w;
  pendingHeight = h;
  createImageBitmap(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }))
    .then(bitmap => {
      if (pendingBitmap) { pendingBitmap.close(); }
      pendingBitmap = bitmap;
      scheduleRaf();
    })
    .catch(() => {});
});

// ── Monitor ───────────────────────────────────────────────────────────────────
window.electronAPI.onMonitorList(monitors => {
  monitorSelect.innerHTML = '';
  monitors.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = m.name || `Monitor ${i + 1}`;
    monitorSelect.appendChild(opt);
  });
  monitorPanel.style.display = monitors.length > 1 ? '' : 'none';
});

monitorSelect.addEventListener('change', () =>
  window.electronAPI.switchMonitor(parseInt(monitorSelect.value, 10)));

// ── Screenshot ────────────────────────────────────────────────────────────────
const screenshotStatus = document.getElementById('screenshot-status');

async function takeScreenshot() {
  if (!connected) return;
  const dataUrl = canvas.toDataURL('image/png');
  const file = await window.electronAPI.takeScreenshot(dataUrl);
  screenshotStatus.textContent = file.split(/[\\/]/).pop();
  setTimeout(() => { screenshotStatus.textContent = ''; }, 4000);
}

document.getElementById('btn-screenshot').addEventListener('click', takeScreenshot);

// ── Clipboard ─────────────────────────────────────────────────────────────────
document.getElementById('btn-clipboard').addEventListener('click', () => {
  if (!connected) return;
  window.electronAPI.pushClipboard();
  clipboardStatus.textContent = 'Enviado!';
  setTimeout(() => { clipboardStatus.textContent = ''; }, 2000);
});

window.electronAPI.onClipboardSynced(() => {
  clipboardStatus.textContent = 'Clipboard sincronizado';
  setTimeout(() => { clipboardStatus.textContent = ''; }, 2000);
});

// ── Mouse input ───────────────────────────────────────────────────────────────
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  cursorX = (e.clientX - r.left) * (canvas.width  / r.width);
  cursorY = (e.clientY - r.top)  * (canvas.height / r.height);
  panClientX = e.clientX;
  panClientY = e.clientY;
  if (!connected) return;
  if (dSettings.followCursor) followCursor();
  pendingMx = (e.clientX - r.left) / r.width;
  pendingMy = (e.clientY - r.top)  / r.height;
  pendingMouseMove = true;
  scheduleRaf();
});

canvas.addEventListener('mousedown', e => {
  if (!connected) return;
  e.preventDefault();
  const { nx, ny } = canvasNorm(e);
  window.electronAPI.sendInput({ type: 'mouse_click', nx, ny, button: e.button, down: true });
});

canvas.addEventListener('mouseup', e => {
  if (!connected) return;
  const { nx, ny } = canvasNorm(e);
  window.electronAPI.sendInput({ type: 'mouse_click', nx, ny, button: e.button, down: false });
});

canvas.addEventListener('mouseleave', () => {
  panClientX = -1; panClientY = -1;
  clearCursor();
});

canvas.addEventListener('wheel', e => {
  if (!connected) return;
  e.preventDefault();
  window.electronAPI.sendInput({ type: 'mouse_scroll', dx: Math.sign(e.deltaX), dy: Math.sign(-e.deltaY) });
}, { passive: false });

function canvasNorm(e) {
  const r = canvas.getBoundingClientRect();
  return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
const btnFullscreen = document.getElementById('btn-fullscreen');

function toggleFullscreen() {
  window.electronAPI.toggleFullscreen(dSettings.fullscreenMode || 'exclusive');
}

window.electronAPI.onFullscreenChange(fs => {
  document.body.classList.toggle('fullscreen', fs);
  btnFullscreen.textContent = fs ? '⤡' : '⛶';
  btnFullscreen.title = fs ? 'Sair da tela inteira (F11)' : 'Tela inteira (F11)';
});

btnFullscreen.addEventListener('click', toggleFullscreen);

// ── Keyboard input ────────────────────────────────────────────────────────────
const MODIFIER_CODES = ['ShiftLeft','ShiftRight','ControlLeft','ControlRight',
                        'AltLeft','AltRight'];

function releaseModifiers() {
  if (!connected) return;
  MODIFIER_CODES.forEach(code =>
    window.electronAPI.sendInput({ type: 'key', code, key: '', down: false }));
}

document.addEventListener('keydown', e => {
  // F11: toggle fullscreen, never send to remote
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
  // Escape: exit fullscreen if active, never send to remote
  if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) { toggleFullscreen(); return; }
  // Ctrl+Shift+S: screenshot, never send to remote
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); takeScreenshot(); return; }
  // Win key: never send to remote — causes system-level interruption on the agent machine
  if (e.code === 'MetaLeft' || e.code === 'MetaRight') { e.preventDefault(); return; }

  if (!connected || document.activeElement === chatInput) return;
  e.preventDefault();
  window.electronAPI.sendInput({ type: 'key', code: e.code, key: e.key, down: true });
});

document.addEventListener('keyup', e => {
  if (e.key === 'F11') return;
  if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) return;
  if (e.code === 'MetaLeft' || e.code === 'MetaRight') return;

  if (!connected || document.activeElement === chatInput) return;
  e.preventDefault();
  window.electronAPI.sendInput({ type: 'key', code: e.code, key: e.key, down: false });
});

// Release all modifiers when viewer window loses focus to prevent stuck keys.
window.addEventListener('blur', releaseModifiers);

// ── Chat ──────────────────────────────────────────────────────────────────────
document.getElementById('btn-send-chat').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
  const text = chatInput.value.trim();
  if (!text || !connected) return;
  chatInput.value = '';
  window.electronAPI.sendChat(text);
  ensureChatOpen();
}

window.electronAPI.onChat(() => {
  ensureChatOpen();
});

function appendChat(from, text, cls) {
  const div = document.createElement('div');
  div.className = `chat-msg ${cls}`;
  div.textContent = `${from}: ${text}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── File transfer ─────────────────────────────────────────────────────────────
document.getElementById('btn-send-file').addEventListener('click', async () => {
  if (!connected) return;
  await window.electronAPI.sendFile();
});

window.electronAPI.onFileProgress(({ sent, total }) => {
  const pct = Math.round((sent / total) * 100);
  fileStatus.textContent = `Enviando... ${pct}%`;
  if (sent >= total) setTimeout(() => { fileStatus.textContent = 'Enviado!'; }, 300);
});

window.electronAPI.onFileIncoming(({ name, size }) =>
  { fileStatus.textContent = `Recebendo: ${name} (${fmtBytes(size)})`; });

window.electronAPI.onFileSaved(p =>
  { fileStatus.textContent = `Salvo em: ${p}`; });

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtBytes(n) {
  if (n < 1024)    return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
