const dgram  = require('dgram');
const crypto = require('crypto');
const os     = require('os');
const { DISCOVERY_PORT, ANNOUNCE_INTERVAL_MS, WS_PORT, DISCOVERY_TOKEN } = require('../../shared/protocol');

class AgentDiscovery {
  constructor() { this.socket = null; this.timer = null; }

  start() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('error', err => console.error('[Discovery] Erro:', err.message));
    this.socket.bind(0, () => {
      this.socket.setBroadcast(true);
      this._announce();
      this.timer = setInterval(() => this._announce(), ANNOUNCE_INTERVAL_MS);
    });
  }

  _getLocalIPv4() {
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

  _announce() {
    const body = JSON.stringify({
      type:     'AGENT_ANNOUNCE',
      hostname: os.hostname(),
      ip:       this._getLocalIPv4(),
      port:     WS_PORT,
      version:  '1.0.0',
    });
    const sig = crypto.createHmac('sha256', DISCOVERY_TOKEN).update(body).digest('hex');
    const payload = Buffer.from(JSON.stringify({ b: body, s: sig }));
    this.socket?.send(payload, 0, payload.length, DISCOVERY_PORT, '255.255.255.255');
  }

  stop() {
    if (this.timer)  { clearInterval(this.timer); this.timer = null; }
    if (this.socket) { this.socket.close(); this.socket = null; }
  }
}

module.exports = AgentDiscovery;
