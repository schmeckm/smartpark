'use strict';

const crypto = require('crypto');

const PREFIX = 'v1|traffic-provider|';

function deriveKeyMaterial() {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  const env = require('../config/env');
  return crypto.createHash('sha256').update(`${PREFIX}${env.jwtSecret}`, 'utf8').digest();
}

/**
 * AES-256-GCM encrypt (base64 payload: iv(12) + tag(16) + ciphertext).
 * @param {string} plaintext
 */
function encryptSecret(plaintext) {
  const key = deriveKeyMaterial();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * @param {string} payloadB64
 * @returns {string}
 */
function decryptSecret(payloadB64) {
  const key = deriveKeyMaterial();
  const buf = Buffer.from(String(payloadB64), 'base64');
  if (buf.length < 12 + 16 + 1) {
    throw new Error('INVALID_CIPHER_PAYLOAD');
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
