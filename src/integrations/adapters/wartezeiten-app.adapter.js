const { ProviderAdapterInterface } = require('./provider-adapter.interface');
const { requestJson } = require('./http-client');
const { normalizeScheduleDateString } = require('../../utils/schedule-date.util');

const PROVIDER = 'wartezeiten_app';
const BASE_URL = 'https://api.wartezeiten.app';

function canonicalBase(messageType, x) {
  return {
    messageType,
    provider: PROVIDER,
    providerMessageId: null,
    externalDestinationId: x.externalDestinationId || 'wartezeiten-app',
    externalParkId: x.externalParkId || null,
    externalEntityId: x.externalEntityId || null,
    entityType: x.entityType || null,
    occurredAt: x.occurredAt || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    payload: x.payload || {},
    rawPayload: x.rawPayload || {},
    status: 'RECEIVED',
    errorMessage: null,
  };
}

class WartezeitenAppAdapter extends ProviderAdapterInterface {
  getProviderInfo() {
    return {
      provider: PROVIDER,
      name: 'Wartezeiten.APP',
      baseUrl: BASE_URL,
      capabilities: {
        destinations: false,
        parks: true,
        entities: false,
        liveData: true,
        calendar: true,
        crowdLevel: true,
      },
    };
  }

  async fetchDestinations() {
    return [
      {
        id: 'wartezeiten-app',
        name: 'Wartezeiten.APP Parks',
        slug: 'wartezeiten-app',
        entityType: 'DESTINATION',
      },
    ];
  }

  async fetchParks() {
    const waits = await requestJson(`${BASE_URL}/v1/waitingtimes`);
    const byPark = new Map();
    for (const row of waits?.data || waits || []) {
      const parkId = String(row.parkId || row.park_id || row.park || '');
      if (!parkId) continue;
      if (!byPark.has(parkId)) {
        byPark.set(parkId, { id: parkId, name: row.parkName || `Park ${parkId}`, slug: null, entityType: 'PARK' });
      }
    }
    return [...byPark.values()];
  }

  async fetchEntities(_parkId) {
    return [];
  }

  async fetchEntity(entityId) {
    return { id: entityId, name: `Entity ${entityId}`, entityType: 'PARK' };
  }

  async fetchEntityLive(entityId) {
    return { id: entityId, liveData: [] };
  }

  async fetchEntitySchedule(entityId) {
    return { id: entityId, schedule: [] };
  }

  fetchLiveData(_parkId) {
    return requestJson(`${BASE_URL}/v1/waitingtimes`);
  }

  fetchCalendar(_parkId) {
    return requestJson(`${BASE_URL}/v1/openingtimes`);
  }

  fetchCrowdLevel(_parkId) {
    return requestJson(`${BASE_URL}/v1/crowdlevel`);
  }

  normalizeToCanonicalMessages(input) {
    const type = input?.type;
    const list = [];
    if (type === 'destinations') {
      for (const d of input.items || []) {
        list.push(
          canonicalBase('DESTINATION_SYNCED', {
            externalDestinationId: d.id,
            entityType: 'DESTINATION',
            payload: { externalDestinationId: d.id, name: d.name, slug: d.slug || null },
            rawPayload: d,
          })
        );
      }
    } else if (type === 'parks') {
      for (const p of input.items || []) {
        list.push(
          canonicalBase('PARK_SYNCED', {
            externalParkId: String(p.id || ''),
            entityType: 'PARK',
            payload: {
              externalParkId: String(p.id || ''),
              externalDestinationId: 'wartezeiten-app',
              name: p.name || 'Unknown park',
              slug: p.slug || null,
            },
            rawPayload: p,
          })
        );
      }
    } else if (type === 'live') {
      for (const r of input.items?.data || input.items || []) {
        const parkId = String(r.parkId || r.park_id || r.park || '');
        const entityId = String(r.attractionId || r.id || r.entityId || '');
        if (!parkId || !entityId) continue;
        list.push(
          canonicalBase('WAIT_TIME_UPDATED', {
            externalParkId: parkId,
            externalEntityId: entityId,
            entityType: 'ATTRACTION',
            payload: {
              externalEntityName: r.name || r.attractionName || 'Unknown attraction',
              entityType: 'ATTRACTION',
              waitTime: typeof r.waitTime === 'number' ? r.waitTime : null,
              status: r.status || null,
              isOpen: r.isOpen != null ? Boolean(r.isOpen) : null,
              sampledAt: new Date().toISOString(),
            },
            rawPayload: r,
          })
        );
      }
    } else if (type === 'calendar') {
      for (const c of input.items?.data || input.items || []) {
        const parkId = String(c.parkId || c.park_id || c.park || '');
        if (!parkId) continue;
        list.push(
          canonicalBase('PARK_OPERATING_HOURS_UPDATED', {
            externalParkId: parkId,
            entityType: 'PARK',
            payload: {
              date: normalizeScheduleDateString(c.date ?? c.day ?? null),
              openingTime: c.openingTime || c.open || null,
              closingTime: c.closingTime || c.close || null,
              type: c.type || 'OPERATING',
            },
            rawPayload: c,
          })
        );
      }
    } else if (type === 'crowd') {
      for (const c of input.items?.data || input.items || []) {
        const parkId = String(c.parkId || c.park_id || c.park || '');
        if (!parkId) continue;
        list.push(
          canonicalBase('PARK_CROWD_LEVEL_UPDATED', {
            externalParkId: parkId,
            entityType: 'PARK',
            payload: {
              crowdLevel: c.crowdLevel ?? c.level ?? null,
              unit: c.unit || 'PERCENT',
              label: c.label || null,
            },
            rawPayload: c,
          })
        );
      }
    }
    return list;
  }
}

module.exports = { WartezeitenAppAdapter };
