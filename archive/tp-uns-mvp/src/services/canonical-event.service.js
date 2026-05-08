const { Park, CanonicalEvent, LatestState } = require('../models');
const { AppError } = require('../utils/app-error');

function metricToEventType(metric) {
  if (metric === 'status') return 'RIDE_STATUS_CHANGED';
  if (metric === 'queue_time') return 'QUEUE_TIME_OBSERVED';
  if (metric === 'vehicle_count') return 'VEHICLE_COUNTED';
  if (metric === 'people_flow') return 'PEOPLE_FLOW_COUNTED';
  if (metric === 'occupancy') return 'OCCUPANCY_OBSERVED';
  if (metric === 'congestion_factor') return 'TRAFFIC_OBSERVED';
  if (metric === 'crowd_index') return 'FORECAST_OBSERVED';
  return 'STATUS_OBSERVED';
}

function extractFromTopic(topic) {
  const parts = String(topic || '').split('/');
  if (parts.length < 6 || parts[0] !== 'tpuns') throw new AppError('Invalid TP-UNS topic', 422);
  return {
    parkSlug: parts[1],
    version: parts[2],
    domain: parts[3],
    assetSlug: parts[4],
    metric: parts[5],
  };
}

class CanonicalEventService {
  async createFromMqttMessage(topic, payload) {
    const p = extractFromTopic(topic);
    const park = await Park.findOne({ where: { slug: p.parkSlug } });
    if (!park) throw new AppError(`Park not found for slug ${p.parkSlug}`, 404);

    const eventType = metricToEventType(p.metric);
    const eventTime = payload.ts ? new Date(payload.ts) : new Date();

    const event = await CanonicalEvent.create({
      parkId: park.id,
      topicPath: topic,
      eventType,
      eventTime,
      source: payload.source || 'mqtt',
      quality: payload.quality || 'GOOD',
      confidence: payload.confidence == null ? null : Number(payload.confidence),
      payloadJson: payload,
    });

    await LatestState.upsert({
      parkId: park.id,
      topicPath: topic,
      value: payload.value == null ? payload : payload.value,
      eventTime,
      source: payload.source || 'mqtt',
      quality: payload.quality || 'GOOD',
    });

    return event;
  }
}

module.exports = { CanonicalEventService, metricToEventType };
