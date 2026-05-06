/**
 * Normalize ThemeParks / provider schedule `date` values to YYYY-MM-DD for DB lookups.
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeScheduleDateString(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

module.exports = { normalizeScheduleDateString };
