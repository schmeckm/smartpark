const crypto = require('crypto');

/**
 * @param {unknown} obj
 * @returns {string}
 */
function payloadFingerprint(obj) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length) {
    const o = { ...obj };
    const keys = Object.keys(o).sort();
    const ordered = keys.reduce((acc, k) => {
      acc[k] = o[k];
      return acc;
    }, {});
    return crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
  }
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

module.exports = { payloadFingerprint };
