'use strict';

const { AppError } = require('../../../utils/app-error');
const { UNS_ROOT, DEFAULT_VERSION, LEVEL_SET } = require('./topic-layout.constants');
const { parseV1, buildV1, isV1TopicPath } = require('./topic-layout.v1');
const { parseV2, buildV2, isV2TopicPath } = require('./topic-layout.v2');

/**
 * Detect layout from path shape:
 * - v2: `tpuns/{park}/v1/{level}/{asset}/{domain}/{metric}` (7 segments; level ∈ park|zones|rides)
 * - v1: `tpuns/{park}/v1/{domain}/{asset}/{metric}` (6 segments)
 *
 * @param {string} topicPath
 * @returns {'v1'|'v2'|null}
 */
function detectLayout(topicPath) {
  const t = String(topicPath || '').trim();
  const parts = t.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== UNS_ROOT || parts[2] !== DEFAULT_VERSION) {
    return null;
  }
  if (parts.length === 7 && LEVEL_SET.has(String(parts[3] || '').toLowerCase())) {
    return 'v2';
  }
  if (parts.length === 6) {
    return 'v1';
  }
  return null;
}

/**
 * Parse any supported UNS topic layout into a normalized signal identity.
 *
 * @param {string} topicPath
 * @returns {{ layout: 'v1'|'v2', parkSlug: string, level: string|null, assetSlug: string, domain: string, metric: string, signalKey: string }}
 */
function parseAny(topicPath) {
  const t = String(topicPath || '').trim();
  const layout = detectLayout(t);
  if (layout === 'v2') {
    return parseV2(t);
  }
  if (layout === 'v1') {
    return parseV1(t);
  }
  throw new AppError('Invalid UNS topic path (unsupported segment count or layout)', 422, { code: 'INVALID_TOPIC_LAYOUT' });
}

module.exports = {
  detectLayout,
  parseAny,
  parseV1,
  parseV2,
  buildV1,
  buildV2,
  isV1TopicPath,
  isV2TopicPath,
};
