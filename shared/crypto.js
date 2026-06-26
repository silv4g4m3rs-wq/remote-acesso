'use strict';
const crypto = require('crypto');

const CURVE    = 'prime256v1';
const ALGO     = 'aes-256-gcm';
const NONCE_LEN = 12;
const TAG_LEN   = 16;
const HKDF_INFO = Buffer.from('remoteacesso-v2');
const KEY_LEN   = 32;

// First byte of the key-exchange message (plaintext, before encryption is negotiated)
const KEX_BYTE = 0xFE;

function createECDH() {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  return ecdh;
}

function deriveKey(ecdh, peerPublicBuffer) {
  const secret = ecdh.computeSecret(peerPublicBuffer);
  return Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.alloc(0), HKDF_INFO, KEY_LEN));
}

function encrypt(key, plaintext) {
  const nonce = crypto.randomBytes(NONCE_LEN);
  const c = crypto.createCipheriv(ALGO, key, nonce);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([nonce, c.getAuthTag(), ct]);
}

function decrypt(key, buf) {
  if (!Buffer.isBuffer(buf) || buf.length < NONCE_LEN + TAG_LEN)
    throw new Error('message too short');
  const nonce = buf.slice(0, NONCE_LEN);
  const tag   = buf.slice(NONCE_LEN, NONCE_LEN + TAG_LEN);
  const ct    = buf.slice(NONCE_LEN + TAG_LEN);
  const d = crypto.createDecipheriv(ALGO, key, nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

function makeKexMessage(ecdh) {
  const pk   = ecdh.getPublicKey().toString('base64');
  const json = Buffer.from(JSON.stringify({ type: 'kex', pk }));
  const msg  = Buffer.allocUnsafe(1 + json.length);
  msg[0] = KEX_BYTE;
  json.copy(msg, 1);
  return msg;
}

function parseKexMessage(buf) {
  if (!Buffer.isBuffer(buf) || buf[0] !== KEX_BYTE) return null;
  try {
    const m = JSON.parse(buf.slice(1).toString());
    if (m.type !== 'kex' || typeof m.pk !== 'string') return null;
    return Buffer.from(m.pk, 'base64');
  } catch {
    return null;
  }
}

module.exports = { createECDH, deriveKey, encrypt, decrypt, makeKexMessage, parseKexMessage, KEX_BYTE };
