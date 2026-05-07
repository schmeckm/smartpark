const { WartezeitenAppAdapter } = require('./client');

const adapter = new WartezeitenAppAdapter();

function toObservation(row) {
  return {
    eventType: 'QUEUE_TIME_OBSERVED',
    domain: 'rides',
    assetSlug: String(row?.name || row?.attractionName || row?.id || 'unknown')
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '_'),
    metric: 'queue_time',
    value: typeof row.waitTime === 'number' ? row.waitTime : null,
    unit: 'min',
    eventTime: row?.lastUpdated || new Date().toISOString(),
    quality: 'GOOD',
    confidence: 0.9,
    source: 'wartezeiten_app',
    rawPayload: row || {},
  };
}

async function validateConfig(_config) {
  return { valid: true, errors: [] };
}

async function discover(_config) {
  const parks = await adapter.fetchParks();
  return (Array.isArray(parks) ? parks : []).map((p) => ({ id: p.id, name: p.name, entityType: 'PARK' }));
}

async function poll(config) {
  const live = await adapter.fetchLiveData(config?.parkId);
  const rows = live?.data || live || [];
  return (Array.isArray(rows) ? rows : []).map(toObservation);
}

async function health(_config) {
  try {
    await adapter.fetchParks();
    return { ok: true, message: 'Adapter reachable' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

module.exports = { validateConfig, discover, poll, health };
