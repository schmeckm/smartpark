const { AppError } = require('./app-error');

/**
 * Parse query/body datetime strings that must be unambiguous UTC or offset-based ISO instants.
 * Rejects date-only or timezone-less strings to avoid engine-dependent local interpretation.
 *
 * @param {string} label - e.g. "from"
 * @param {unknown} value
 * @returns {Date}
 */
function parseRequiredUtcOrOffsetInstant(label, value) {
  const s = String(value ?? '').trim();
  if (!s) {
    throw new AppError(`${label} is required`, 400, { code: 'INVALID_DATETIME_QUERY' });
  }
  const hasExplicitZone =
    /Z$/i.test(s) ||
    /[+-]\d{2}:\d{2}$/.test(s) ||
    /[+-]\d{2}\d{2}$/.test(s) ||
    /[+-]\d{2}:\d{2}:\d{2}$/.test(s);
  if (!hasExplicitZone) {
    throw new AppError(
      `${label} must be an ISO-8601 instant with explicit offset or Z (UTC), e.g. 2026-04-29T16:30:19.000Z`,
      400,
      { code: 'INVALID_DATETIME_QUERY' }
    );
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`Invalid ${label}`, 400, { code: 'INVALID_DATETIME_QUERY' });
  }
  return d;
}

module.exports = { parseRequiredUtcOrOffsetInstant };
