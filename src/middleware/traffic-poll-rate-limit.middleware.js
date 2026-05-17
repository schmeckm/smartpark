'use strict';

const env = require('../config/env');
const { AppError } = require('../utils/app-error');

/** @type {Map<string, number[]>} */
const buckets = new Map();

function pruneOld(timestamps, windowMs, now) {
  const cutoff = now - windowMs;
  while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
}

/**
 * In-memory rate limit for manual TomTom poll (per user + park).
 */
function trafficPollRateLimit(req, res, next) {
  const max = env.trafficPollRateLimitMaxPerWindow;
  const windowMs = env.trafficPollRateLimitWindowMs;
  if (!max || max <= 0) return next();

  const parkId = req.validated?.parkId || req.body?.parkId;
  const userId = req.user?.id ? String(req.user.id) : 'anon';
  const key = `${userId}:${parkId || 'no-park'}`;
  const now = Date.now();
  let ts = buckets.get(key);
  if (!ts) {
    ts = [];
    buckets.set(key, ts);
  }
  pruneOld(ts, windowMs, now);
  if (ts.length >= max) {
    return next(
      new AppError('Traffic poll rate limit exceeded — try again shortly', 429, {
        code: 'TRAFFIC_POLL_RATE_LIMIT',
      })
    );
  }
  ts.push(now);
  return next();
}

module.exports = { trafficPollRateLimit };
