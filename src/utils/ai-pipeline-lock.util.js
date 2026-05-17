'use strict';

const { AppError } = require('./app-error');

/** @type {Map<string, boolean>} */
const locks = new Map();

function lockKey(parkId) {
  return parkId ? `park:${String(parkId)}` : 'global';
}

/**
 * @param {string|null|undefined} parkId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withAiPipelineLock(parkId, fn) {
  const key = lockKey(parkId);
  if (locks.get(key)) {
    throw new AppError('AI pipeline already running for this scope', 409, { code: 'AI_PIPELINE_BUSY' });
  }
  locks.set(key, true);
  try {
    return await fn();
  } finally {
    locks.delete(key);
  }
}

function isAiPipelineLocked(parkId) {
  return Boolean(locks.get(lockKey(parkId)));
}

module.exports = { withAiPipelineLock, isAiPipelineLocked };
