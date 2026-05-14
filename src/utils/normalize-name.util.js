const UMLAUT_REPLACEMENTS = {
  ae: /[äæ]/g,
  oe: /[öœ]/g,
  ue: /[ü]/g,
  ss: /[ß]/g,
};

/**
 * Normalize names/slugs for deterministic matching.
 * - lowercases
 * - strips accents/diacritics
 * - normalizes apostrophes/punctuation/spacing
 * - normalizes common umlauts
 *
 * @param {unknown} input
 * @returns {string}
 */
function normalizeName(input) {
  let out = String(input || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  out = out.replace(UMLAUT_REPLACEMENTS.ae, 'ae');
  out = out.replace(UMLAUT_REPLACEMENTS.oe, 'oe');
  out = out.replace(UMLAUT_REPLACEMENTS.ue, 'ue');
  out = out.replace(UMLAUT_REPLACEMENTS.ss, 'ss');

  out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  out = out.replace(/['"`]/g, '');
  out = out.replace(/&/g, ' and ');
  out = out.replace(/[^a-z0-9]+/g, ' ');
  out = out.trim().replace(/\s+/g, ' ');
  return out;
}

/**
 * @param {unknown} input
 * @returns {string}
 */
function normalizeSlug(input) {
  return normalizeName(input).replace(/\s+/g, '_');
}

module.exports = {
  normalizeName,
  normalizeSlug,
};
