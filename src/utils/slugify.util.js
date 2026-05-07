'use strict';

/**
 * Canonical slug used across UNS topic builders, Sparkplug routing, theme-parks
 * entity domain mapping, and integration orchestration.
 *
 * Lowercases, replaces any non-alphanumeric run with a single underscore,
 * and trims leading/trailing underscores.
 *
 * Stable contract: callers depend on `null`/`undefined` becoming `''` and
 * the run-collapsing rule. Do not change without updating every consumer
 * and re-running the UNS topic-layout tests.
 *
 * @param {unknown} name
 * @returns {string}
 */
function slugifyName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
}

module.exports = { slugifyName };
