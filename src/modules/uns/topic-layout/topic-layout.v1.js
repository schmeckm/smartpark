'use strict';

const { AppError } = require('../../../utils/app-error');
const { slugifyName } = require('../uns-topic-generator.service');
const { TOPIC_V1_PATH_REGEX } = require('./topic-layout.constants');

/**
 * @param {string} topicPath
 * @returns {boolean}
 */
function isV1TopicPath(topicPath) {
  return TOPIC_V1_PATH_REGEX.test(String(topicPath || ''));
}

/**
 * Parse legacy v1 topic: `tpuns/{park}/v1/{domain}/{asset}/{metric}`.
 * @param {string} topicPath
 * @returns {{ layout: 'v1', parkSlug: string, level: null, assetSlug: string, domain: string, metric: string, signalKey: string }}
 */
function parseV1(topicPath) {
  const t = String(topicPath || '').trim();
  if (!isV1TopicPath(t)) {
    throw new AppError('Invalid UNS topic path (v1 layout)', 422, { code: 'INVALID_TOPIC_V1' });
  }
  const parts = t.split('/').filter(Boolean);
  const [, parkSlug, version, domain, assetSlug, metric] = parts;
  if (version !== 'v1') {
    throw new AppError('Invalid UNS topic path (v1 requires v1 segment)', 422, { code: 'INVALID_TOPIC_V1' });
  }
  const signalKey = `${domain}.${metric}`;
  return {
    layout: 'v1',
    parkSlug,
    level: null,
    assetSlug,
    domain,
    metric,
    signalKey,
  };
}

/**
 * Build legacy v1 topic path (same shape as existing UNS topic generator).
 * @param {{ parkSlug: string; domain: string; assetSlug: string; metric: string; version?: string }} identity
 * @returns {string}
 */
function buildV1(identity) {
  const parkSlug = String(identity?.parkSlug || '').trim();
  const domain = String(identity?.domain || '').trim();
  const assetSlug = String(identity?.assetSlug || '').trim();
  const metric = String(identity?.metric || '').trim();
  const version = String(identity?.version || 'v1').trim() || 'v1';
  if (!parkSlug || !domain || !assetSlug || !metric) {
    throw new AppError('buildV1 requires parkSlug, domain, assetSlug, and metric', 422, { code: 'INVALID_TOPIC_IDENTITY' });
  }
  if (version !== 'v1') {
    throw new AppError('buildV1 only supports version v1', 422, { code: 'INVALID_TOPIC_IDENTITY' });
  }
  return `tpuns/${slugifyName(parkSlug)}/${version}/${slugifyName(domain)}/${slugifyName(assetSlug)}/${slugifyName(metric)}`;
}

module.exports = {
  isV1TopicPath,
  parseV1,
  buildV1,
};
