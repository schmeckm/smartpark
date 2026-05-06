const { publishMqtt } = require('../../../services/mqtt-connector.service');
const { logger } = require('../../../utils/logger');

function baseTopic(parkSlug, assetSlug) {
  const p = String(parkSlug || 'park')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/gi, '-');
  const a = String(assetSlug || 'asset')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/gi, '-');
  return `smartpark/${p}/assets/${a}`;
}

/**
 * Publish UNS-style asset telemetry per enterprise topic convention.
 * @param {{ parkSlug: string; assetSlug: string; metricCode: string; metricValue: string; unit?: string | null; timestamp?: string }} p
 */
async function publishMQTTState(p) {
  const { parkSlug, assetSlug, metricCode, metricValue, unit, timestamp } = p;
  const ts = timestamp || new Date().toISOString();
  const base = baseTopic(parkSlug, assetSlug);
  const payload = { value: metricValue, unit: unit || null, ts };

  try {
    if (metricCode === 'QUEUE_TIME_MIN') {
      await publishMqtt(`${base}/queue_time`, JSON.stringify({ ...payload, unit: unit || 'min' }));
      return { published: true, topic: `${base}/queue_time` };
    }
    if (metricCode === 'STATUS' || metricCode === 'STATUS_CODE') {
      await publishMqtt(`${base}/status`, JSON.stringify(payload));
      return { published: true, topic: `${base}/status` };
    }
    if (metricCode === 'HEALTH' || metricCode === 'DOWNTIME_MIN') {
      await publishMqtt(`${base}/health`, JSON.stringify(payload));
      return { published: true, topic: `${base}/health` };
    }
    return { published: false, reason: 'metric_not_routed_to_mqtt', metricCode };
  } catch (e) {
    logger.warn({ err: e.message, metricCode }, 'asset mqtt publish failed');
    return { published: false, reason: e.message };
  }
}

module.exports = { publishMQTTState, baseTopic };
