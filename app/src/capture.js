// Runs in hidden Electron renderer — no require(), uses window.electronAPI from preload

// Adaptive quality defaults (mirrors shared/protocol.js constants)
const TARGET_FPS   = 30;
const JPEG_QUALITY = 0.80;
const MIN_FPS      = 5;
const MAX_FPS      = 60;
const MIN_QUALITY  = 0.40;
const MAX_QUALITY  = 0.90;

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

let sources      = [];
let currentIndex = 0;
let stream       = null;
let imageCapture = null;
let captureTimer = null;
let busy         = false;
let skipCount    = 0;

// Mutable quality targets — updated by viewer quality preference
let targetFps  = TARGET_FPS;
let targetQual = JPEG_QUALITY;
let minQual    = MIN_QUALITY;
let maxQual    = MAX_QUALITY;

// Current adaptive values
let fps     = targetFps;
let quality = targetQual;

// Adaptive quality: adjust fps and quality based on encode backpressure
setInterval(() => {
  const targetSkipRate = fps * 0.3; // allow 30% skip
  if (skipCount > targetSkipRate) {
    quality = Math.max(minQual, quality - 0.08);
    fps     = Math.max(MIN_FPS, fps - 2);
    restartTimer();
  } else if (skipCount === 0 && (fps < targetFps || quality < targetQual)) {
    quality = Math.min(targetQual, quality + 0.04);
    fps     = Math.min(targetFps, fps + 1);
    restartTimer();
  }
  skipCount = 0;
}, 3000);

// Quality preset update from viewer settings
window.electronAPI.onQualityChange(q => {
  targetFps  = q.fps        ?? TARGET_FPS;
  targetQual = q.quality    ?? JPEG_QUALITY;
  minQual    = q.minQuality ?? MIN_QUALITY;
  maxQual    = q.maxQuality ?? MAX_QUALITY;
  fps        = targetFps;
  quality    = targetQual;
  restartTimer();
});

function restartTimer() {
  if (!captureTimer) return;
  clearInterval(captureTimer);
  captureTimer = setInterval(captureFrame, Math.floor(1000 / fps));
}

async function startCapture(index) {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  imageCapture = null;
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }

  const src = sources[index];
  if (!src) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource:   'desktop',
          chromeMediaSourceId: src.id,
        },
      },
    });

    const track = stream.getVideoTracks()[0];
    imageCapture = new ImageCapture(track);

    // Grab one frame to get real dimensions before starting the loop
    const probe = await imageCapture.grabFrame();
    canvas.width  = probe.width  || 1920;
    canvas.height = probe.height || 1080;
    probe.close();

    captureTimer = setInterval(captureFrame, Math.floor(1000 / fps));
  } catch (err) {
    console.error('[Capture] Erro ao iniciar captura:', err);
    window.electronAPI.sendCaptureError(String(err));
  }
}

function captureFrame() {
  if (!imageCapture || busy) { skipCount++; return; }
  busy = true;

  imageCapture.grabFrame().then(bitmap => {
    if (canvas.width !== bitmap.width)   canvas.width  = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob null')), 'image/jpeg', quality)
    );
  }).then(blob => blob.arrayBuffer()).then(buf => {
    window.electronAPI.sendFrame(new Uint8Array(buf), canvas.width, canvas.height);
    busy = false;
  }).catch(() => { busy = false; });
}

async function init() {
  sources = await window.electronAPI.getSources();

  if (sources.length === 0) {
    window.electronAPI.sendCaptureError('Nenhuma fonte de captura encontrada. Verifique Configuracoes > Privacidade > Gravacao de tela.');
    return;
  }

  // Include display dimensions so agent/input.js can use the correct screen bounds
  const monitors = sources.map(s => ({
    index:  s.index,
    name:   s.name,
    width:  s.width  || canvas.width,
    height: s.height || canvas.height,
  }));
  window.electronAPI.sendMonitorList(monitors);

  window.electronAPI.onSwitchMonitor(index => {
    currentIndex = index;
    startCapture(index);
  });

  await startCapture(0);
}

init().catch(err => console.error('[Capture] Init error:', err));
