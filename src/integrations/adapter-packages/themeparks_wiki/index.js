const { ThemeParksWikiAdapter } = require('../../../integrations/adapters/themeparks-wiki.adapter');
const {
  getThemeparksWikiParkIdFromIntegrationSettings,
} = require('../../../services/themeparks-wiki-selected-park.service');
const { trackedGet, truncateForDebug } = require('./poll-debug-fetch');

const adapter = new ThemeParksWikiAdapter();

async function resolveParkId(config) {
  const raw = config?.parkId;
  if (raw != null && String(raw).trim() !== '') return String(raw).trim();
  return getThemeparksWikiParkIdFromIntegrationSettings();
}

function toObservation(row) {
  const wait = row?.queue?.STANDBY?.waitTime;
  return {
    eventType: typeof wait === 'number' ? 'QUEUE_TIME_OBSERVED' : 'STATUS_OBSERVED',
    domain: 'rides',
    assetSlug: String(row?.name || row?.id || 'unknown').toLowerCase().replaceAll(/[^a-z0-9]+/g, '_'),
    metric: typeof wait === 'number' ? 'queue_time' : 'status',
    value: typeof wait === 'number' ? wait : row?.status || null,
    unit: typeof wait === 'number' ? 'min' : null,
    eventTime: row?.lastUpdated || new Date().toISOString(),
    quality: 'GOOD',
    confidence: 0.95,
    source: 'themeparks_wiki',
    rawPayload: row || {},
  };
}

async function validateConfig(config) {
  const parkId = await resolveParkId(config || {});
  const ok = Boolean(parkId);
  return {
    valid: ok,
    errors: ok
      ? []
      : [
          'No parkId: set configJson.parkId (UUID) or choose a park under Integration settings → Destination / park selection (ThemeParks.wiki) and Save selection.',
        ],
  };
}

async function discover(config) {
  const parkId = await resolveParkId(config);
  const entities = await adapter.fetchEntities(parkId);
  return (Array.isArray(entities) ? entities : []).map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType || 'OTHER',
  }));
}

async function poll(config) {
  const parkId = await resolveParkId(config);
  const apiCalls = [];
  const enc = encodeURIComponent(parkId);
  const entity = await trackedGet(`entity/${enc}`, apiCalls);
  const children = await trackedGet(`entity/${enc}/children`, apiCalls);
  const live = await trackedGet(`entity/${enc}/live`, apiCalls);
  const schedule = await trackedGet(`entity/${enc}/schedule`, apiCalls);

  let rows = [];
  if (live && Array.isArray(live.liveData)) rows = live.liveData;
  else if (Array.isArray(live)) rows = live;
  const observations = rows.map(toObservation);

  const parkName = entity && typeof entity === 'object' ? entity.name || null : null;
  let childList = [];
  if (Array.isArray(children)) childList = children;
  else if (children && typeof children === 'object' && Array.isArray(children.children)) childList = children.children;

  return {
    observations,
    debug: {
      provider: 'themeparks_wiki',
      parkId,
      parkName,
      apiCalls,
      rawInput: {
        entity: entity || null,
        children: truncateForDebug(childList),
        live: live || null,
        schedule: schedule || null,
      },
    },
  };
}

async function health(_config) {
  try {
    await adapter.fetchDestinations();
    return { ok: true, message: 'Adapter reachable' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

module.exports = { validateConfig, discover, poll, health };
