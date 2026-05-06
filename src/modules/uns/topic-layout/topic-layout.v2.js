'use strict';

const { AppError } = require('../../../utils/app-error');
const { slugifyName } = require('../uns-topic-generator.service');
const { TOPIC_V2_PATH_REGEX, isSupportedDomain, isSupportedLevel } = require('./topic-layout.constants');

/**
 * @param {string} topicPath
 * @returns {boolean}
 */
function isV2TopicPath(topicPath) {
  return TOPIC_V2_PATH_REGEX.test(String(topicPath || ''));
}

/**
 * Parse v2 topic: `tpuns/{park}/v1/{level}/{asset}/{domain}/{metric}`.
 * @param {string} topicPath
 * @returns {{ layout: 'v2', parkSlug: string, level: string, assetSlug: string, domain: string, metric: string, signalKey: string }}
 */
function parseV2(topicPath) {
  const t = String(topicPath || '').trim();
  if (!isV2TopicPath(t)) {
    throw new AppError('Invalid UNS topic path (v2 layout)', 422, { code: 'INVALID_TOPIC_V2' });
  }
  const parts = t.split('/').filter(Boolean);
  const [, parkSlug, version, level, assetSlug, domain, metric] = parts;
  if (version !== 'v1') {
    throw new AppError('Invalid UNS topic path (v2 requires v1 segment)', 422, { code: 'INVALID_TOPIC_V2' });
  }
  const lv = String(level || '').toLowerCase();
  const dom = String(domain || '').toLowerCase();
  if (!isSupportedLevel(lv) || !isSupportedDomain(dom)) {
    throw new AppError('Invalid UNS topic path (v2 level/domain)', 422, { code: 'INVALID_TOPIC_V2' });
  }
  const signalKey = `${dom}.${metric}`;
  return {
    layout: 'v2',
    parkSlug,
    level: lv,
    assetSlug,
    domain: dom,
    metric,
    signalKey,
  };
}

/**
 * Build v2 topic path: `tpuns/{park}/v1/{level}/{asset}/{domain}/{metric}`.
 * @param {{ parkSlug: string; level: string; assetSlug: string; domain: string; metric: string; version?: string }} identity
 * @returns {string}
 */
function buildV2(identity) {
  const parkSlug = String(identity?.parkSlug || '').trim();
  const level = String(identity?.level || '').trim().toLowerCase();
  const assetSlug = String(identity?.assetSlug || '').trim();
  const domain = String(identity?.domain || '').trim().toLowerCase();
  const metric = String(identity?.metric || '').trim();
  const version = String(identity?.version || 'v1').trim() || 'v1';
  if (!parkSlug || !level || !assetSlug || !domain || !metric) {
    throw new AppError('buildV2 requires parkSlug, level, assetSlug, domain, and metric', 422, { code: 'INVALID_TOPIC_IDENTITY' });
  }
  if (version !== 'v1') {
    throw new AppError('buildV2 only supports version v1', 422, { code: 'INVALID_TOPIC_IDENTITY' });
  }
  if (!isSupportedLevel(level)) {
    throw new AppError(`Unsupported level: ${level}`, 422, { code: 'INVALID_TOPIC_LEVEL' });
  }
  if (!isSupportedDomain(domain)) {
    throw new AppError(`Unsupported domain: ${domain}`, 422, { code: 'INVALID_TOPIC_DOMAIN' });
  }
  return `tpuns/${slugifyName(parkSlug)}/${version}/${slugifyName(level)}/${slugifyName(assetSlug)}/${slugifyName(domain)}/${slugifyName(metric)}`;
}

module.exports = {
  isV2TopicPath,
  parseV2,
  buildV2,
};
