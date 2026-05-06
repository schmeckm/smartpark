const { generateTopicPath } = require('../modules/uns/uns-topic-generator.service');

/**
 * @param {Record<string, unknown>} observation
 * @param {{ parkSlug?: string; sparkplugGroupId?: string; source?: string }} context
 */
function encode(observation, context) {
  const topicPark =
    (context?.sparkplugGroupId && String(context.sparkplugGroupId).trim()) ||
    (context?.parkSlug && String(context.parkSlug).trim());
  if (!topicPark) {
    return { profile: 'uns_json', error: 'context.sparkplugGroupId or context.parkSlug is required for UNS topic' };
  }
  const domain = observation.domain;
  const assetSlug = observation.assetSlug;
  const metric = observation.metric;
  if (!domain || !assetSlug || !metric) {
    return { profile: 'uns_json', error: 'observation.domain, assetSlug, and metric are required' };
  }
  const topic = generateTopicPath({ parkSlug: topicPark, domain, assetSlug, metric });
  const ts = observation.eventTime || new Date().toISOString();
  const payload = {
    v: 1,
    ts,
    domain,
    assetSlug,
    metric,
    value: observation.value,
    unit: observation.unit ?? null,
    quality: observation.quality ?? 'GOOD',
    confidence: observation.confidence ?? null,
    source: observation.source || context.source || 'output_encoder',
    eventType: observation.eventType || null,
  };
  return { profile: 'uns_json', topic, payload };
}

module.exports = { encode };
