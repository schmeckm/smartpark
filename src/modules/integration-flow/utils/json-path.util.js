'use strict';

/**
 * Simple JSON path helper: "$.a.b.c" from object root (leading "$" ignored).
 * @param {unknown} obj
 * @param {string} pathStr
 * @returns {unknown}
 */
function getByDollarPath(obj, pathStr) {
  if (pathStr == null || typeof pathStr !== 'string') return undefined;
  const p = pathStr.trim();
  if (!p.startsWith('$')) return undefined;
  const parts = p
    .slice(1)
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

module.exports = { getByDollarPath };
