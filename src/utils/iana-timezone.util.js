/**
 * @param {string} tz
 * @returns {boolean}
 */
function isValidIanaTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  const s = tz.trim();
  if (!s || s.length > 64) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: s }).format();
    return true;
  } catch {
    return false;
  }
}

module.exports = { isValidIanaTimeZone };
