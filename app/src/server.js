'use strict';
const { WebSocketServer } = require('ws');
const { EventEmitter }    = require('events');
const {
  MSG, WS_PORT, AUTH_TIMEOUT_MS, MAX_AUTH_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS, MAX_FILE_SIZE, PROTOCOL_VERSION,
} = require('../../shared/protocol');
const { createECDH, deriveKey, encrypt, decrypt, makeKexMessage, parseKexMessage } = require('../../shared/crypto');
const { createLogger } = require('../../shared/logger');

const log = createLogger('server');

class AgentServer extends EventEmitter {
  constructor(password) {
    super();
    this.wss        = null;
    this.password   = password;
    this.clients    = new Set();
    this.monitors   = [];
    this._fileRecv  = null;
    this._ipAttempts = new Map();
  }

  start() {
    this.wss = new WebSocketServer({ port: WS_PORT });

    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress || 'unknown';

      if (this._isBlocked(ip)) {
        log.warn('IP bloqueado por rate limit', { ip });
        ws.close();
        return;
      }

      const ecdh  = createECDH();
      let encKey  = null;
      let authed  = false;

      const sendMsg = (obj) => {
        if (ws.readyState !== ws.OPEN || !encKey) return;
        const json  = Buffer.from(JSON.stringify(obj), 'utf8');
        const plain = Buffer.allocUnsafe(1 + json.length);
        plain[0] = 0x00;
        json.copy(plain, 1);
        ws.send(encrypt(encKey, plain));
      };

      ws.send(makeKexMessage(ecdh));

      const authTimer = setTimeout(() => {
        if (!authed) { log.warn('Auth timeout', { ip }); ws.close(); }
      }, AUTH_TIMEOUT_MS);

      ws.on('message', raw => {
        if (!Buffer.isBuffer(raw)) return;

        // Phase 1: key exchange (plaintext)
        if (!encKey) {
          const peerKey = parseKexMessage(raw);
          if (!peerKey) { log.warn('KEX invalido', { ip }); ws.close(); return; }
          try {
            encKey       = deriveKey(ecdh, peerKey);
            ws._encKey   = encKey;
            ws._sendMsg  = sendMsg;
          } catch (e) {
            log.error('Falha no KEX', { ip, error: e.message });
            ws.close();
          }
          return;
        }

        // Decrypt
        let plain;
        try { plain = decrypt(encKey, raw); }
        catch { log.warn('Falha na decriptografia', { ip }); ws.close(); return; }

        // Phase 2: authentication
        if (!authed) {
          clearTimeout(authTimer);
          let msg;
          try { msg = JSON.parse(plain.slice(1).toString()); } catch {
            sendMsg({ type: MSG.AUTH_FAIL }); ws.close(); return;
          }
          if (msg.type === MSG.AUTH && msg.password === this.password) {
            authed = true;
            this._clearAttempts(ip);
            this.clients.add(ws);
            log.info('Viewer autenticado', { ip, total: this.clients.size });
            this.emit('viewer-count', this.clients.size);
            sendMsg({ type: MSG.AUTH_OK, version: PROTOCOL_VERSION });
            if (this.monitors.length > 0)
              sendMsg({ type: MSG.MONITOR_LIST, monitors: this.monitors });
          } else {
            this._recordAttempt(ip);
            log.warn('Auth falhou — senha incorreta', { ip });
            sendMsg({ type: MSG.AUTH_FAIL });
            ws.close();
          }
          return;
        }

        this._handleMessage(ws, plain);
      });

      ws.on('close', () => {
        clearTimeout(authTimer);
        this.clients.delete(ws);
        if (authed) {
          log.info('Viewer desconectado', { total: this.clients.size });
          this.emit('viewer-count', this.clients.size);
        }
      });

      ws.on('error', err => {
        log.error('Erro WS', { ip, error: err.message });
        this.clients.delete(ws);
      });
    });

    this.wss.on('error', err => {
      log.error('Erro WSS', { error: err.message });
      // Attempt restart if port was in use
      if (err.code === 'EADDRINUSE') {
        setTimeout(() => { if (!this.wss?.address()) this.start(); }, 5000);
      }
    });
    log.info('Servidor iniciado', { port: WS_PORT, version: PROTOCOL_VERSION });
  }

  stop() {
    this.clients.forEach(ws => ws.close());
    this.clients.clear();
    if (this.wss) { this.wss.close(); this.wss = null; }
    log.info('Servidor parado');
  }

  _isBlocked(ip) {
    const e = this._ipAttempts.get(ip);
    return !!(e?.blockedUntil && Date.now() < e.blockedUntil);
  }

  _recordAttempt(ip) {
    const now = Date.now();
    let e = this._ipAttempts.get(ip) || { count: 0, first: now, blockedUntil: 0 };
    if (now - e.first > RATE_LIMIT_WINDOW_MS) e = { count: 0, first: now, blockedUntil: 0 };
    e.count++;
    if (e.count >= MAX_AUTH_ATTEMPTS) {
      e.blockedUntil = now + RATE_LIMIT_WINDOW_MS;
      log.warn('IP bloqueado por excesso de tentativas', {
        ip, until: new Date(e.blockedUntil).toISOString(),
      });
    }
    this._ipAttempts.set(ip, e);
  }

  _clearAttempts(ip) { this._ipAttempts.delete(ip); }

  _handleMessage(ws, plain) {
    let msg;
    try { msg = JSON.parse(plain.slice(1).toString()); } catch { return; }

    switch (msg.type) {
      case MSG.MOUSE_MOVE:
      case MSG.MOUSE_CLICK:
      case MSG.MOUSE_SCROLL:
      case MSG.KEY:
        this.emit('input', msg);
        break;
      case MSG.MONITOR_SWITCH:
        this.emit('monitor-switch', msg.index);
        break;
      case MSG.CHAT:
        this.emit('chat', msg.text);
        break;
      case MSG.CLIPBOARD:
        this.emit('clipboard', msg.text);
        break;
      case MSG.FILE_START: {
        const size = msg.size || 0;
        if (size > MAX_FILE_SIZE) {
          log.warn('Arquivo rejeitado: muito grande', { name: msg.name, sizeMB: Math.round(size / 1024 / 1024) });
          if (ws._sendMsg) ws._sendMsg({
            type: MSG.CHAT,
            text: `[Sistema] Arquivo rejeitado: ${Math.round(size / 1024 / 1024)} MB excede o limite de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB`,
          });
          return;
        }
        ws._fileRecv = { name: msg.name, size, chunks: [], received: 0 };
        break;
      }
      case MSG.FILE_CHUNK:
        if (ws._fileRecv) {
          const chunk = Buffer.from(msg.data, 'base64');
          ws._fileRecv.received += chunk.length;
          if (ws._fileRecv.received > MAX_FILE_SIZE) {
            log.warn('Transferencia abortada: limite excedido');
            ws._fileRecv = null;
            return;
          }
          ws._fileRecv.chunks.push(chunk);
        }
        break;
      case MSG.FILE_END:
        if (ws._fileRecv) {
          const data = Buffer.concat(ws._fileRecv.chunks);
          this.emit('file-received', { name: ws._fileRecv.name, data });
          ws._fileRecv = null;
        }
        break;
    }
  }

  broadcastFrame(jpegBuf, width, height) {
    if (this.clients.size === 0) return;
    const header = Buffer.allocUnsafe(9);
    header[0] = 0x01;
    header.writeUInt32LE(width,  1);
    header.writeUInt32LE(height, 5);
    const plain = Buffer.concat([header, jpegBuf]);
    for (const ws of this.clients) {
      if (ws.readyState !== ws.OPEN || !ws._encKey) continue;
      if (ws.bufferedAmount > 0) continue;
      ws.send(encrypt(ws._encKey, plain));
    }
  }

  setMonitorList(monitors)       { this.monitors = monitors; }
  broadcastMonitorList(monitors) { this._broadcastControl({ type: MSG.MONITOR_LIST, monitors }); }
  broadcastChat(text)            { this._broadcastControl({ type: MSG.CHAT, text }); }
  broadcastClipboard(text)       { this._broadcastControl({ type: MSG.CLIPBOARD, text }); }

  _broadcastControl(obj) {
    for (const ws of this.clients)
      if (ws.readyState === ws.OPEN && ws._sendMsg) ws._sendMsg(obj);
  }
}

module.exports = AgentServer;
