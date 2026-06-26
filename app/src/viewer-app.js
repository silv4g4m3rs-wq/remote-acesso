// ── State ─────────────────────────────────────────────────────────────────────
let connected = false;
let currentAgent = null;
let pendingAuthAgent = null;
let pendingAuthLi = null;

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

// ── Screen frames ──────────────────────────────────────────────────────────────
let renderPending = false;

window.electronAPI.onFrame((jpeg, w, h) => {
  frameWidth = w; frameHeight = h;
  if (canvas.width  !== w) canvas.width  = w;
  if (canvas.height !== h) canvas.height = h;

  if (renderPending) return;
  renderPending = true;

  createImageBitmap(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }))
    .then(bitmap => { ctx.drawImage(bitmap, 0, 0); bitmap.close(); renderPending = false; })
    .catch(() => { renderPending = false; });
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
  if (!connected) return;
  const { nx, ny } = canvasNorm(e);
  window.electronAPI.sendInput({ type: 'mouse_move', nx, ny });
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
  window.electronAPI.toggleFullscreen();
}

window.electronAPI.onFullscreenChange(fs => {
  document.body.classList.toggle('fullscreen', fs);
  btnFullscreen.textContent = fs ? '⤡' : '⛶';
  btnFullscreen.title = fs ? 'Sair da tela inteira (F11)' : 'Tela inteira (F11)';
});

btnFullscreen.addEventListener('click', toggleFullscreen);

// ── Keyboard input ────────────────────────────────────────────────────────────
const MODIFIER_CODES = ['ShiftLeft','ShiftRight','ControlLeft','ControlRight',
                        'AltLeft','AltRight','MetaLeft','MetaRight'];

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

  if (!connected || document.activeElement === chatInput) return;
  e.preventDefault();
  window.electronAPI.sendInput({ type: 'key', code: e.code, key: e.key, down: true });
});

document.addEventListener('keyup', e => {
  if (e.key === 'F11') return;
  if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) return;

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
  appendChat('Eu', text, 'me');
}

window.electronAPI.onChat(text => appendChat('Agente', text, 'them'));

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
