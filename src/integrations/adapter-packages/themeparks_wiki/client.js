/**
 * ThemeParks.wiki public API — https://api.themeparks.wiki/v1
 *
 * Model: everything is an entity (id, name, entityType, parentId, destinationId, parkId, …).
 * Destinations have no parent; parks sit under destinations; ATTRACTION / SHOW / RESTAURANT / HOTEL
 * are usually under a park but may be parented directly to a destination per API docs.
 *
 * Operations: live data is cached server-side; docs recommend refreshing live ~every 5 minutes.
 * Rate limit: 300 requests/minute per client; 429 + Retry-After — see `http-client.js`.
 *
 * @see https://themeparks.wiki/ — API base: https://api.themeparks.wiki/v1
 */
const { ProviderAdapterInterface } = require('../../adapters/provider-adapter.interface');
const { requestJson } = require('../../adapters/http-client');
const { slugifyName } = require('../../../modules/uns/uns-topic-generator.service');
const { normalizeScheduleDateString } = require('../../../utils/schedule-date.util');

const PROVIDER = 'themeparks_wiki';
const BASE_URL = 'https://api.themeparks.wiki/v1';

function toArray(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  if (Array.isArray(input.data)) return input.data;
  if (Array.isArray(input.items)) return input.items;
  if (Array.isArray(input.destinations)) return input.destinations;
  if (Array.isArray(input.children)) return input.children;
  if (Array.isArray(input.liveData)) return input.liveData;
  if (Array.isArray(input.schedule)) return input.schedule;
  return [];
}

function toEntityType(v) {
  const t = String(v || '').toUpperCase();
  if (
    [
      'ATTRACTION',
      'SHOW',
      'RESTAURANT',
      'HOTEL',
      'PARK',
      'DESTINATION',
      'SHOP',
      'TRANSPORT',
      'SERVICE',
      'PLAYGROUND',
    ].includes(t)
  ) {
    return t;
  }
  return 'OTHER';
}

function canonicalBase(messageType, x) {
  return {
    messageType,
    provider: PROVIDER,
    providerMessageId: null,
    externalDestinationId: x.externalDestinationId || null,
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

class ThemeParksWikiAdapter extends ProviderAdapterInterface {
  getProviderInfo() {
    return {
      provider: PROVIDER,
      name: 'ThemeParks.wiki',
      baseUrl: BASE_URL,
      capabilities: {
        destinations: true,
        parks: true,
        entities: true,
        liveData: true,
        calendar: true,
        crowdLevel: false,
      },
    };
  }

  fetchDestinations() {
    return requestJson(`${BASE_URL}/destinations`);
  }

  async fetchParks(destinationId) {
    const children = await requestJson(`${BASE_URL}/entity/${encodeURIComponent(destinationId)}/children`);
    return toArray(children).filter((x) => ['PARK'].includes(String(x.entityType || x.type || '').toUpperCase()));
  }

  fetchEntities(parkId) {
    return requestJson(`${BASE_URL}/entity/${encodeURIComponent(parkId)}/children`);
  }

  fetchEntity(entityId) {
    return requestJson(`${BASE_URL}/entity/${encodeURIComponent(entityId)}`);
  }

  fetchEntityLive(entityId) {
    return requestJson(`${BASE_URL}/entity/${encodeURIComponent(entityId)}/live`);
  }

  fetchEntitySchedule(entityId, options = {}) {
    if (options.year && options.month) {
      return requestJson(
        `${BASE_URL}/entity/${encodeURIComponent(entityId)}/schedule/${encodeURIComponent(options.year)}/${encodeURIComponent(options.month)}`
      );
    }
    return requestJson(`${BASE_URL}/entity/${encodeURIComponent(entityId)}/schedule`);
  }

  fetchLiveData(parkId) {
    return requestJson(`${BASE_URL}/entity/${encodeURIComponent(parkId)}/live`);
  }

  async fetchCalendar(parkId, options = {}) {
    if (options.year && options.month) {
      return requestJson(
        `${BASE_URL}/entity/${encodeURIComponent(parkId)}/schedule/${encodeURIComponent(options.year)}/${encodeURIComponent(options.month)}`
      );
    }
    return requestJson(`${BASE_URL}/entity/${encodeURIComponent(parkId)}/schedule`);
  }

  normalizeToCanonicalMessages(input) {
    const type = input?.type;
    const items = toArray(input?.items);
    const list = [];
    if (type === 'destinations') {
      for (const d of items) {
        const id = String(d.id || d.destinationId || '');
        const name = d.name || 'Unknown destination';
        const slug = slugifyName(d.slug || name || id);
        list.push(
          canonicalBase('DESTINATION_SYNCED', {
            externalDestinationId: id,
            externalEntityId: id,
            entityType: 'DESTINATION',
            payload: {
              id,
              name,
              entityType: 'DESTINATION',
              parentId: null,
              destinationId: null,
              parkId: null,
              timezone: d.timezone || null,
              externalId: id,
              slug,
              tags: Array.isArray(d.tags) ? d.tags : [],
              location:
                d.location && typeof d.location === 'object'
                  ? {
                      latitude: typeof d.location.latitude === 'number' ? d.location.latitude : null,
                      longitude: typeof d.location.longitude === 'number' ? d.location.longitude : null,
                    }
                  : null,
              externalDestinationId: id,
            },
            rawPayload: d,
          })
        );
      }
    } else if (type === 'parks') {
      for (const p of items) {
        const id = String(p.id || '');
        const name = p.name || 'Unknown park';
        const slug = slugifyName(p.slug || name || id);
        list.push(
          canonicalBase('PARK_SYNCED', {
            externalDestinationId: input.destinationId || null,
            externalParkId: id,
            externalEntityId: id,
            entityType: 'PARK',
            payload: {
              id,
              name,
              entityType: 'PARK',
              parentId:
                p.parentId != null && String(p.parentId).trim() !== ''
                  ? String(p.parentId)
                  : input.destinationId != null
                    ? String(input.destinationId)
                    : null,
              destinationId:
                p.destinationId != null && String(p.destinationId).trim() !== ''
                  ? String(p.destinationId)
                  : input.destinationId != null
                    ? String(input.destinationId)
                    : null,
              parkId: null,
              timezone: p.timezone || null,
              externalId: id,
              slug,
              tags: Array.isArray(p.tags) ? p.tags : [],
              location:
                p.location && typeof p.location === 'object'
                  ? {
                      latitude: typeof p.location.latitude === 'number' ? p.location.latitude : null,
                      longitude: typeof p.location.longitude === 'number' ? p.location.longitude : null,
                    }
                  : null,
              externalParkId: id,
              externalDestinationId: input.destinationId || null,
            },
            rawPayload: p,
          })
        );
      }
    } else if (type === 'entities') {
      for (const e of items) {
        const id = String(e.id || '');
        const name = e.name || 'Unknown entity';
        const slug = slugifyName(e.slug || name || id);
        const location =
          e.location && typeof e.location === 'object'
            ? {
                latitude: typeof e.location.latitude === 'number' ? e.location.latitude : null,
                longitude: typeof e.location.longitude === 'number' ? e.location.longitude : null,
              }
            : null;
        const parentId = e.parentId != null && String(e.parentId).trim() !== '' ? String(e.parentId) : null;
        const destinationId =
          e.destinationId != null && String(e.destinationId).trim() !== '' ? String(e.destinationId) : null;
        const parkId =
          e.parkId != null && String(e.parkId).trim() !== '' ? String(e.parkId) : input.parkId != null ? String(input.parkId) : null;
        list.push(
          canonicalBase('PARK_ENTITY_SYNCED', {
            externalParkId: input.parkId,
            externalEntityId: id,
            entityType: toEntityType(e.entityType),
            payload: {
              id,
              name,
              entityType: toEntityType(e.entityType),
              parentId,
              destinationId,
              parkId,
              timezone: e.timezone || null,
              externalId: id,
              slug,
              location,
              tags: Array.isArray(e.tags) ? e.tags : [],
              externalEntityName: name,
              parentExternalParkId: input.parkId,
            },
            rawPayload: e,
          })
        );
      }
    } else if (type === 'live') {
      for (const l of items) {
        const entityType = toEntityType(l.entityType);
        const status = l.status || null;
        const externalEntityId = String(l.id || l.entityId || '');
        if (!externalEntityId) continue;
        const liveName = l.name || 'Unknown entity';
        const liveSlug = slugifyName(l.slug || liveName || externalEntityId);
        const liveParentId = l.parentId != null && String(l.parentId).trim() !== '' ? String(l.parentId) : null;
        const liveDestinationId =
          l.destinationId != null && String(l.destinationId).trim() !== '' ? String(l.destinationId) : null;
        const liveParkId =
          l.parkId != null && String(l.parkId).trim() !== '' ? String(l.parkId) : input.parkId != null ? String(input.parkId) : null;
        const liveLocation =
          l.location && typeof l.location === 'object'
            ? {
                latitude: typeof l.location.latitude === 'number' ? l.location.latitude : null,
                longitude: typeof l.location.longitude === 'number' ? l.location.longitude : null,
              }
            : null;
        if (typeof l.queue?.STANDBY?.waitTime === 'number') {
          list.push(
            canonicalBase('WAIT_TIME_UPDATED', {
              externalParkId: input.parkId,
              externalEntityId,
              entityType,
              payload: {
                id: externalEntityId,
                name: liveName,
                slug: liveSlug,
                parentId: liveParentId,
                destinationId: liveDestinationId,
                parkId: liveParkId,
                timezone: l.timezone || null,
                externalId: externalEntityId,
                externalEntityName: liveName,
                entityType,
                tags: Array.isArray(l.tags) ? l.tags : [],
                waitTime: l.queue.STANDBY.waitTime,
                status,
                isOpen: status === 'OPERATING',
                sampledAt: new Date().toISOString(),
                location: liveLocation,
              },
              rawPayload: l,
            })
          );
        }
        list.push(
          canonicalBase('ENTITY_STATUS_UPDATED', {
            externalParkId: input.parkId,
            externalEntityId,
            entityType,
            payload: {
              id: externalEntityId,
              name: liveName,
              slug: liveSlug,
              parentId: liveParentId,
              destinationId: liveDestinationId,
              parkId: liveParkId,
              timezone: l.timezone || null,
              externalId: externalEntityId,
              externalEntityName: liveName,
              entityType,
              tags: Array.isArray(l.tags) ? l.tags : [],
              status,
              isOpen: status === 'OPERATING',
              sampledAt: new Date().toISOString(),
              location: liveLocation,
            },
            rawPayload: l,
          })
        );
      }
    } else if (type === 'calendar') {
      for (const c of items) {
        const dateRaw = c.date ?? c.day ?? c.scheduleDate ?? null;
        const dateNorm = normalizeScheduleDateString(dateRaw);
        list.push(
          canonicalBase('PARK_OPERATING_HOURS_UPDATED', {
            externalParkId: input.parkId,
            entityType: 'PARK',
            payload: {
              date: dateNorm,
              openingTime: c.openingTime ?? c.opening ?? c.open ?? null,
              closingTime: c.closingTime ?? c.closing ?? c.close ?? null,
              type: c.type || 'OPERATING',
            },
            rawPayload: c,
          })
        );
      }
    }
    return list;
  }
}

module.exports = { ThemeParksWikiAdapter };
