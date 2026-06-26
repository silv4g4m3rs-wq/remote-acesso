'use strict';
const dgram  = require('dgram');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { DISCOVERY_PORT, MAX_AGENTS, DISCOVERY_TOKEN } = require('../../shared/protocol');

class ViewerDiscovery extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.agents = new Map();
  }

  start() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('error', err => console.error('[Discovery] Erro:', err.message));

    this.socket.on('message', (raw, rinfo) => {
      let envelope;
      try { envelope = JSON.parse(raw.toString()); } catch { return; }
      if (typeof envelope.b !== 'string' || typeof envelope.s !== 'string') return;

      const expected = crypto.createHmac('sha256', DISCOVERY_TOKEN).update(envelope.b).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(envelope.s))) return;

      let msg;
      try { msg = JSON.parse(envelope.b); } catch { return; }
      if (msg.type !== 'AGENT_ANNOUNCE') return;

      const host = msg.ip || rinfo.address;
      const key  = `${host}:${msg.port}`;

      if (!this.agents.has(key) && this.agents.size >= MAX_AGENTS) return;

      const agent = {
        host,
        port:     msg.port,
        hostname: msg.hostname,
        version:  msg.version,
        lastSeen: Date.now(),
      };

      const isNew = !this.agents.has(key);
      this.agents.set(key, agent);
      if (isNew) this.emit('agent', agent);
    });

    this.socket.bind(DISCOVERY_PORT, () => {
      this.socket.setBroadcast(true);
    });

    setInterval(() => {
      const now = Date.now();
      for (const [k, a] of this.agents)
        if (now - a.lastSeen > 6000) this.agents.delete(k);
    }, 6000);
  }

  stop() {
    this.socket?.close();
    this.socket = null;
  }
}

module.exports = ViewerDiscovery;
