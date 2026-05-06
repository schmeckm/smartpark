const { logger } = require('../../utils/logger');
const { AppError } = require('../../utils/app-error');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const ts = Date.parse(value);
  if (Number.isFinite(ts)) return Math.max(0, ts - Date.now());
  return null;
}

async function requestJson(url, { timeoutMs = 12000, retries = 2 } = {}) {
  let attempt = 0;
  while (attempt <= retries) {
    attempt += 1;
    const ac = new AbortController();
    const id = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(id);
      if (res.status === 429) {
        const retryMs = parseRetryAfter(res.headers.get('retry-after')) || 1000 * attempt;
        if (attempt <= retries) {
          await sleep(retryMs);
          continue;
        }
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new AppError(`Provider HTTP ${res.status}: ${txt || res.statusText}`, 502, {
          code: 'PROVIDER_HTTP_ERROR',
          details: { url, status: res.status },
        });
      }
      return res.json();
    } catch (err) {
      clearTimeout(id);
      if (attempt > retries) {
        if (err instanceof AppError) throw err;
        throw new AppError(`Provider request failed: ${err.message}`, 502, {
          code: 'PROVIDER_REQUEST_FAILED',
          details: { url, attempt },
        });
      }
      logger.warn({ err: err.message, url, attempt }, 'provider request retry');
      await sleep(300 * attempt);
    }
  }
  throw new AppError('Provider request exhausted', 502, { code: 'PROVIDER_REQUEST_FAILED' });
}

module.exports = { requestJson };
