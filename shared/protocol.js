const MSG = {
  FRAME:          'frame',
  MONITOR_LIST:   'monitor_list',
  MONITOR_SWITCH: 'monitor_switch',
  MOUSE_MOVE:     'mouse_move',
  MOUSE_CLICK:    'mouse_click',
  MOUSE_SCROLL:   'mouse_scroll',
  KEY:            'key',
  CHAT:           'chat',
  FILE_START:     'file_start',
  FILE_CHUNK:     'file_chunk',
  FILE_END:       'file_end',
  AUTH:           'auth',
  AUTH_OK:        'auth_ok',
  AUTH_FAIL:      'auth_fail',
  CLIPBOARD:      'clipboard',
};

const PROTOCOL_VERSION    = 2;

const DISCOVERY_PORT       = 5454;
const WS_PORT              = 8765;
const ANNOUNCE_INTERVAL_MS = 2000;

// Capture defaults and adaptive quality bounds
const TARGET_FPS   = 15;
const JPEG_QUALITY = 0.80;
const MIN_FPS      = 5;
const MAX_FPS      = 30;
const MIN_QUALITY  = 0.40;
const MAX_QUALITY  = 0.90;

// File transfer
const FILE_CHUNK_SIZE = 64 * 1024;
const MAX_FILE_SIZE   = 500 * 1024 * 1024; // 500 MB

// Security
const AUTH_TIMEOUT_MS      = 10000;
const MAX_AUTH_ATTEMPTS    = 10;
const RATE_LIMIT_WINDOW_MS = 30000;

// Discovery
const MAX_AGENTS = 50;

module.exports = {
  MSG, PROTOCOL_VERSION,
  DISCOVERY_PORT, WS_PORT, ANNOUNCE_INTERVAL_MS,
  TARGET_FPS, JPEG_QUALITY, MIN_FPS, MAX_FPS, MIN_QUALITY, MAX_QUALITY,
  FILE_CHUNK_SIZE, MAX_FILE_SIZE,
  AUTH_TIMEOUT_MS, MAX_AUTH_ATTEMPTS, RATE_LIMIT_WINDOW_MS,
  MAX_AGENTS,
};
