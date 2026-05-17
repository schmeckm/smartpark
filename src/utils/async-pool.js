'use strict';

/**
 * Run async mapper over items with bounded concurrency.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const list = items || [];
  if (!list.length) return [];
  const limit = Math.max(1, Math.min(concurrency, list.length));
  const results = new Array(list.length);
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const i = nextIndex++;
      if (i >= list.length) break;
      results[i] = await fn(list[i], i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

module.exports = { mapWithConcurrency };
