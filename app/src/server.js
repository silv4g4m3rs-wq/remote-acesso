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

// Timeout for human to respond to an access request (2 minutes)
const ACCESS_REQUEST_TIMEOUT_MS = 120000;

class AgentServer extends EventEmitter {
  constructor(password) {
    super();
    this.wss            = null;
    this.password       = password;
    this.clients        = new Set();          // authorized viewers
    this.pendingClients = new Map();          // ws → { ip, timer, sendMsg }
    this.monitors       = [];
    this._ipAttempts    = new Map();
  }

  start() {
    // No verifyClient — accept all WS upgrades and handle auth at protocol level.
    // This prevents "Unexpected server response: 403" from being thrown by the ws client.
    this.wss = new WebSocketServer({ port: WS_PORT });

    // Ping authorized clients every 25 s
    this._heartbeat = setInterval(() => {
      for (const ws of this.clients) {
        if (ws._pingDead) { ws.terminate(); continue; }
        ws._pingDead = true;
        ws.ping();
      }
    }, 25000);

    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress || 'unknown';

      // Rate-limit check at protocol level (post-upgrade)
      if (this._isBlocked(ip)) {
        log.warn('IP bloqueado por rate limit — conexão recusada', { ip });
        ws.close(1008, 'Too Many Requests');
        return;
      }

      const ecdh  = createECDH();
      let encKey  = null;
      ws._authed  = false;

      const sendMsg = (obj) => {
        if (ws.readyState !== ws.OPEN || !encKey) return;
        const json  = Buffer.from(JSON.stringify(obj), 'utf8');
        const plain = Buffer.allocUnsafe(1 + json.length);
        plain[0] = 0x00;
        json.copy(plain, 1);
        ws.send(encrypt(encKey, plain));
      };

      ws._sendMsg = sendMsg;
      ws.send(makeKexMessage(ecdh));

      const authTimer = setTimeout(() => {
        if (!ws._authed && !this.pendingClients.has(ws)) {
          log.warn('Auth timeout', { ip });
          ws.close();
        }
      }, AUTH_TIMEOUT_MS);

      ws.on('message', raw => {
        if (!Buffer.isBuffer(raw)) return;

        // Phase 1: key exchange (plaintext)
        if (!encKey) {
          const peerKey = parseKexMessage(raw);
          if (!peerKey) { log.warn('KEX invalido', { ip }); ws.close(); return; }
          try {
            encKey     = deriveKey(ecdh, peerKey);
            ws._encKey = encKey;
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
        if (!ws._authed) {
          clearTimeout(authTimer);
          let msg;
          try { msg = JSON.parse(plain.slice(1).toString()); } catch {
            sendMsg({ type: MSG.AUTH_FAIL }); ws.close(); return;
          }

          if (msg.type === MSG.AUTH && msg.password === this.password) {
            // Correct password → authorize immediately
            ws._authed = true;
            this._clearAttempts(ip);
            ws._pingDead = false;
            ws.on('pong', () => { ws._pingDead = false; });
            this.clients.add(ws);
            log.info('Viewer autenticado', { ip, total: this.clients.size });
            this.emit('viewer-count', this.clients.size);
            sendMsg({ type: MSG.AUTH_OK, version: PROTOCOL_VERSION });
            if (this.monitors.length > 0)
              sendMsg({ type: MSG.MONITOR_LIST, monitors: this.monitors });

          } else if (msg.type === MSG.ACCESS_REQUEST) {
            // No password — viewer is requesting manual access from agent
            const accessTimer = setTimeout(() => {
              if (this.pendingClients.has(ws)) {
                log.warn('Access request timeout', { ip });
                this.pendingClients.delete(ws);
                sendMsg({ type: MSG.ACCESS_REJECTED, reason: 'timeout' });
                ws.close();
              }
            }, ACCESS_REQUEST_TIMEOUT_MS);
            this.pendingClients.set(ws, { ip, timer: accessTimer, sendMsg });
            log.info('Viewer solicitou acesso manual', { ip });
            this.emit('access-request', ws, ip);

          } else {
            // Wrong password
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
        // Clean up if still pending
        const pending = this.pendingClients.get(ws);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingClients.delete(ws);
          this.emit('access-request-cancelled', ws);
        }
        this.clients.delete(ws);
        if (ws._authed) {
          log.info('Viewer desconectado', { ip, total: this.clients.size });
          this.emit('viewer-count', this.clients.size);
        }
      });

      ws.on('error', err => {
        log.error('Erro WS', { ip, error: err.message });
        this.clients.delete(ws);
        this.pendingClients.delete(ws);
      });
    });

    this.wss.on('error', err => {
      log.error('Erro WSS', { error: err.message });
      if (err.code === 'EADDRINUSE') {
        setTimeout(() => { if (!this.wss?.address()) this.start(); }, 5000);
      }
    });
    log.info('Servidor iniciado', { port: WS_PORT, version: PROTOCOL_VERSION });
  }

  // Accept a pending access request — moves viewer from pending → authorized
  acceptPending(ws) {
    const entry = this.pendingClients.get(ws);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pendingClients.delete(ws);
    ws._authed   = true;
    ws._pingDead = false;
    ws.on('pong', () => { ws._pingDead = false; });
    this.clients.add(ws);
    entry.sendMsg({ type: MSG.ACCESS_ACCEPTED });
    if (this.monitors.length > 0)
      entry.sendMsg({ type: MSG.MONITOR_LIST, monitors: this.monitors });
    log.info('Acesso aceito pelo agente', { ip: entry.ip, total: this.clients.size });
    this.emit('viewer-count', this.clients.size);
    return true;
  }

  // Reject a pending access request
  rejectPending(ws) {
    const entry = this.pendingClients.get(ws);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pendingClients.delete(ws);
    entry.sendMsg({ type: MSG.ACCESS_REJECTED });
    log.info('Acesso recusado pelo agente', { ip: entry.ip });
    setTimeout(() => { try { ws.close(); } catch {} }, 200);
    return true;
  }

  stop() {
    clearInterval(this._heartbeat); this._heartbeat = null;
    for (const [ws, { timer }] of this.pendingClients) {
      clearTimeout(timer);
      try { ws.close(); } catch {}
    }
    this.pendingClients.clear();
    this.clients.forEach(ws => { try { ws.close(); } catch {} });
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
      case MSG.QUALITY:
        this.emit('quality-change', {
          fps:        msg.fps,
          quality:    msg.quality,
          minQuality: msg.minQuality,
          maxQuality: msg.maxQuality,
        });
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

  setMonitorList(monitors)            { this.monitors = monitors; }
  broadcastMonitorList(monitors)      { this._broadcastControl({ type: MSG.MONITOR_LIST, monitors }); }
  broadcastChat(text)                 { this._broadcastControl({ type: MSG.CHAT, text }); }
  broadcastClipboard(text)            { this._broadcastControl({ type: MSG.CLIPBOARD, text }); }
  broadcastWindowFocus(x, y, w, h)   { this._broadcastControl({ type: MSG.WINDOW_FOCUS, x, y, w, h }); }

  _broadcastControl(obj) {
    for (const ws of this.clients)
      if (ws.readyState === ws.OPEN && ws._sendMsg) ws._sendMsg(obj);
  }
}

module.exports = AgentServer;
