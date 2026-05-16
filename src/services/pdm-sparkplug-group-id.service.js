'use strict';

const env = require('../config/env');
const { slugifyName } = require('../modules/uns/uns-topic-generator.service');

function sparkplugGroupIdForParkSlug(parkSlug) {
  const fromEnv = env.sparkplugGroupId && String(env.sparkplugGroupId).trim();
  if (fromEnv) return fromEnv;
  return slugifyName(parkSlug || 'park');
}

module.exports = { sparkplugGroupIdForParkSlug };
