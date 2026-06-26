'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

let _logDir = null;

function getLogDir() {
  if (_logDir) return _logDir;
  _logDir = path.join(os.homedir(), 'AppData', 'Local', 'RemoteAcesso', 'logs');
  try { fs.mkdirSync(_logDir, { recursive: true }); } catch {}
  return _logDir;
}

function write(level, component, message, extra) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...(extra !== undefined ? { data: extra } : {}),
  }) + '\n';

  try {
    const today = new Date().toISOString().slice(0, 10);
    const file  = path.join(getLogDir(), `remoteacesso-${today}.log`);
    fs.appendFileSync(file, entry, { encoding: 'utf8' });
  } catch {}

  if (level === 'error') console.error(`[${component}] ${message}`, extra ?? '');
  else if (level === 'warn') console.warn(`[${component}] ${message}`, extra ?? '');
  else if (process.env.RA_DEBUG) console.log(`[${component}] ${message}`, extra ?? '');
}

function createLogger(component) {
  return {
    debug: (msg, data) => write('debug', component, msg, data),
    info:  (msg, data) => write('info',  component, msg, data),
    warn:  (msg, data) => write('warn',  component, msg, data),
    error: (msg, data) => write('error', component, msg, data),
  };
}

module.exports = { createLogger };
