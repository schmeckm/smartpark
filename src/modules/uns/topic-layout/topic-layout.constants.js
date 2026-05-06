'use strict';

/** Root segment for Smart Park UNS / TP-UNS topics. */
const UNS_ROOT = 'tpuns';

/** Default topic version segment (path, not semver). */
const DEFAULT_VERSION = 'v1';

/**
 * Supported domain segments for v2 layout (Phase A contract only).
 * @type {readonly string[]}
 */
const SUPPORTED_DOMAINS = Object.freeze([
  'operations',
  'queue',
  'green',
  'maintenance',
  'weather',
  'guestflow',
  'staffing',
  'safety',
]);

/**
 * Supported level segments for v2 layout (Phase A contract only).
 * @type {readonly string[]}
 */
const SUPPORTED_LEVELS = Object.freeze(['park', 'zones', 'rides']);

const DOMAIN_SET = new Set(SUPPORTED_DOMAINS);
const LEVEL_SET = new Set(SUPPORTED_LEVELS);

/**
 * Legacy v1: `tpuns/{park}/v1/{domain}/{asset}/{metric}` (6 path segments).
 * Matches existing `uns-validator.service.js` contract.
 */
const TOPIC_V1_PATH_REGEX = /^tpuns\/[a-z0-9_]+\/v1\/[a-z0-9_]+\/[a-z0-9_]+\/[a-z0-9_]+$/;

/**
 * Target v2: `tpuns/{park}/v1/{level}/{asset}/{domain}/{metric}` (7 path segments).
 * Level must be one of {@link SUPPORTED_LEVELS}; domain must be one of {@link SUPPORTED_DOMAINS}.
 */
const TOPIC_V2_PATH_REGEX = new RegExp(
  `^tpuns\\/[a-z0-9_]+\\/v1\\/(?:${[...SUPPORTED_LEVELS].join('|')})\\/[a-z0-9_]+\\/(?:${[...SUPPORTED_DOMAINS].join(
    '|'
  )})\\/[a-z0-9_]+$`
);

function isSupportedDomain(domain) {
  return DOMAIN_SET.has(String(domain || '').toLowerCase());
}

function isSupportedLevel(level) {
  return LEVEL_SET.has(String(level || '').toLowerCase());
}

module.exports = {
  UNS_ROOT,
  DEFAULT_VERSION,
  SUPPORTED_DOMAINS,
  SUPPORTED_LEVELS,
  DOMAIN_SET,
  LEVEL_SET,
  TOPIC_V1_PATH_REGEX,
  TOPIC_V2_PATH_REGEX,
  isSupportedDomain,
  isSupportedLevel,
};
