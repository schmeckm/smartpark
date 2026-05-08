'use strict';

/**
 * Phase C3.2 — extracted from `IntegrationOrchestratorService`.
 *
 * Read-only browsing of provider-side data (destinations, parks,
 * entities, schedules). Pure pass-through to the active provider
 * adapter via `ProviderAdapterRegistryService`. No DB writes here —
 * sync into the canonical pipeline lives in the (still-monolithic)
 * orchestrator and will move out in C3.7.
 *
 * The service depends on two collaborators:
 *   - `registryService` (`ProviderAdapterRegistryService`) for adapter
 *     resolution and config CRUD.
 *   - `settingRepository` (`AppSettingRepository`) for the two
 *     fallbacks that still live in this layer:
 *       • `selectedProvider` default for `resolveProvider(undefined)`
 *       • `selectedDestination` default for `listAvailableParks(p, undefined)`
 *
 * The two app_settings keys are inlined here as constants. They are
 * the same string values used by the orchestrator's `SETTING_KEYS`
 * map; C3.3 (IntegrationSettingsService) will own a single source of
 * truth and re-export it.
 *
 * Lock-in covered by:
 *   - `provider-browser.service.test.js` (this commit) — pure logic
 *     tests against an injected fake registry/settings repo.
 *   - `integration-orchestrator.service.contract.test.js` (Phase C3.0)
 *     keeps the orchestrator's public surface intact.
 */

const { AppError } = require('../../../utils/app-error');
const { ProviderAdapterRegistryService } = require('../../../services/provider-adapter-registry.service');
const { AppSettingRepository } = require('../../../repositories/app-setting.repository');

const SETTING_KEY_SELECTED_PROVIDER = 'externalParkData.selectedProvider';
const SETTING_KEY_SELECTED_DESTINATION = 'externalParkData.selectedDestination';
const DEFAULT_PROVIDER = 'themeparks_wiki';

/* ------------------------------------------------------------------ *\
 *  Pure helpers (lifted verbatim from the orchestrator). Exported so  *
 *  the contract test can pin their normalization behavior without     *
 *  needing a registry instance.                                       *
\* ------------------------------------------------------------------ */

function listFromProviderPayload(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function normalizedEntityType(row) {
  return String(row?.entityType || row?.type || '')
    .trim()
    .toUpperCase();
}

function isParkEntity(row) {
  return normalizedEntityType(row) === 'PARK';
}

function isDestinationEntity(row) {
  return normalizedEntityType(row) === 'DESTINATION';
}

function asArray(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  for (const key of ['data', 'items', 'destinations', 'children', 'parks']) {
    if (Array.isArray(input[key])) return input[key];
  }
  return [];
}

/**
 * Walk a heterogeneous provider payload (themeparks.wiki returns a
 * mixed tree with destinations/parks/children/entities) and produce
 * two flat maps keyed by id. Same logic as the orchestrator pre-C3.2.
 *
 * @param {unknown} raw
 * @returns {{ destinations: object[], parks: object[] }}
 */
function normalizeDestinationAndParkRows(raw) {
  const destinationById = new Map();
  const parkById = new Map();
  const seen = new WeakSet();
  const roots = asArray(raw);
  const queue = roots.length
    ? roots.map((row) => ({ row, destinationCtx: null }))
    : [{ row: raw, destinationCtx: null }];

  const upsertDestination = (row) => {
    const id = String(row?.id || row?.destinationId || '').trim();
    if (!id) return null;
    const prev = destinationById.get(id);
    const next = {
      id,
      name: row?.name || prev?.name || 'Unknown destination',
      slug: row?.slug || prev?.slug || null,
      parentId: row?.parentId || prev?.parentId || null,
      destinationId: row?.destinationId || prev?.destinationId || null,
      parkId: row?.parkId || prev?.parkId || null,
      entityType: row?.entityType || row?.type || prev?.entityType || 'DESTINATION',
      timezone: row?.timezone || prev?.timezone || null,
      location: row?.location || prev?.location || null,
      tags: Array.isArray(row?.tags) ? row.tags : prev?.tags || [],
      parks: Array.isArray(prev?.parks) ? prev.parks : [],
    };
    destinationById.set(id, next);
    return next;
  };

  while (queue.length) {
    const { row, destinationCtx } = queue.shift();
    if (!row || typeof row !== 'object') continue;
    if (seen.has(row)) continue;
    seen.add(row);

    let nextDestinationCtx = destinationCtx;
    if (
      isDestinationEntity(row) ||
      (!isParkEntity(row) && (Array.isArray(row.parks) || Array.isArray(row.children)))
    ) {
      const dest = upsertDestination(row);
      if (dest) nextDestinationCtx = { id: dest.id, name: dest.name };
    } else if (row?.destinationId && destinationById.has(String(row.destinationId))) {
      const d = destinationById.get(String(row.destinationId));
      nextDestinationCtx = d ? { id: d.id, name: d.name } : nextDestinationCtx;
    }

    if (isParkEntity(row)) {
      const id = String(row?.id || '').trim();
      if (id) {
        const resolvedDestinationId =
          (nextDestinationCtx?.id && String(nextDestinationCtx.id)) ||
          (row?.destinationId != null ? String(row.destinationId) : null);
        const resolvedDestinationName =
          (nextDestinationCtx?.name && String(nextDestinationCtx.name)) || null;
        parkById.set(id, {
          id,
          name: row?.name || parkById.get(id)?.name || 'Unknown park',
          slug: row?.slug || parkById.get(id)?.slug || null,
          entityType: 'PARK',
          timezone: row?.timezone || parkById.get(id)?.timezone || null,
          destinationId: resolvedDestinationId,
          destinationName: resolvedDestinationName,
        });
      }
    }

    for (const key of ['destinations', 'parks', 'children', 'entities', 'items', 'data']) {
      const arr = row[key];
      if (!Array.isArray(arr)) continue;
      for (const child of arr) queue.push({ row: child, destinationCtx: nextDestinationCtx });
    }
  }

  for (const park of parkById.values()) {
    if (park.destinationId && !park.destinationName && destinationById.has(park.destinationId)) {
      park.destinationName = destinationById.get(park.destinationId)?.name || null;
    }
  }

  for (const park of parkById.values()) {
    if (!park.destinationId) continue;
    const dest = destinationById.get(park.destinationId);
    if (!dest) continue;
    if (!Array.isArray(dest.parks)) dest.parks = [];
    if (!dest.parks.some((p) => String(p.id) === park.id)) {
      dest.parks.push({ id: park.id, name: park.name });
    }
  }

  return {
    destinations: [...destinationById.values()],
    parks: [...parkById.values()],
  };
}

class ProviderBrowserService {
  /**
   * @param {{
   *   registryService?: any,
   *   settingRepository?: { getValue: Function },
   * }} [deps]
   */
  constructor(deps = {}) {
    this.registryService = deps.registryService || new ProviderAdapterRegistryService();
    this.settingRepository = deps.settingRepository || new AppSettingRepository();
  }

  listProviders() {
    return this.registryService.listProviderInfos();
  }

  getProviderConfig(provider) {
    return this.registryService.getConfig(provider);
  }

  patchProviderConfig(provider, patch) {
    return this.registryService.patchConfig(provider, patch);
  }

  /**
   * Resolve the active provider adapter. If no provider is given,
   * fall back to `app_settings[externalParkData.selectedProvider]`
   * (default: themeparks_wiki).
   */
  async resolveProvider(provider) {
    const p =
      provider ||
      (
        await this.settingRepository.getValue(SETTING_KEY_SELECTED_PROVIDER, {
          provider: DEFAULT_PROVIDER,
        })
      ).provider;
    return this.registryService.getAdapter(p);
  }

  async listAvailableDestinations(provider) {
    const adapter = await this.resolveProvider(provider);
    const raw = await adapter.fetchDestinations();
    const normalized = normalizeDestinationAndParkRows(raw);
    if (normalized.destinations.length) return normalized.destinations;
    const rows = listFromProviderPayload(raw, ['destinations', 'data', 'items']);
    return rows
      .filter((d) => {
        const id = String(d?.id || d?.destinationId || '').trim();
        return Boolean(id);
      })
      .map((d) => ({
        id: String(d.id || d.destinationId || ''),
        name: d.name || 'Unknown destination',
        slug: d.slug || null,
        parentId: d.parentId || null,
        destinationId: d.destinationId || null,
        parkId: d.parkId || null,
        entityType: d.entityType || d.type || 'DESTINATION',
        timezone: d.timezone || null,
        location: d.location || null,
        tags: Array.isArray(d.tags) ? d.tags : [],
        parks: Array.isArray(d.parks) ? d.parks : [],
      }));
  }

  async listAvailableParks(provider, destinationId) {
    const adapter = await this.resolveProvider(provider);
    const rawDestinations = await adapter.fetchDestinations();
    const normalized = normalizeDestinationAndParkRows(rawDestinations);
    const destinations = normalized.destinations.length
      ? normalized.destinations
      : await this.listAvailableDestinations(provider);
    let resolvedDestinationId = destinationId;
    if (!resolvedDestinationId) {
      const selectedDestination = await this.settingRepository.getValue(
        SETTING_KEY_SELECTED_DESTINATION,
        null
      );
      if (selectedDestination?.provider === adapter.getProviderInfo().provider) {
        resolvedDestinationId = selectedDestination.externalDestinationId;
      }
    }

    if (normalized.parks.length) {
      return normalized.parks
        .filter(
          (p) => !resolvedDestinationId || String(p.destinationId || '') === String(resolvedDestinationId)
        )
        .map((p) => ({
          id: String(p.id || ''),
          name: p.name || 'Unknown park',
          slug: p.slug || null,
          entityType: 'PARK',
          timezone: p.timezone || null,
          destinationId: p.destinationId || null,
          destinationName: p.destinationName || null,
        }));
    }

    const destination = destinations.find((d) => d.id === resolvedDestinationId);
    if (destination?.parks?.length) {
      return destination.parks.map((p) => ({
        id: String(p.id || ''),
        name: p.name || 'Unknown park',
        slug: p.slug || null,
        entityType: 'PARK',
        timezone: p.timezone || null,
        destinationId: resolvedDestinationId || null,
        destinationName: destination.name || null,
      }));
    }

    if (!resolvedDestinationId) return [];
    const raw = await adapter.fetchParks(resolvedDestinationId);
    const rows = listFromProviderPayload(raw, ['parks', 'data', 'items', 'children']);
    return rows
      .filter((p) => isParkEntity(p))
      .map((p) => ({
        id: String(p.id || ''),
        name: p.name || 'Unknown park',
        slug: p.slug || null,
        entityType: 'PARK',
        timezone: p.timezone || null,
        destinationId: resolvedDestinationId,
        destinationName: destination?.name || null,
      }));
  }

  async getProviderEntity(provider, entityId) {
    const adapter = await this.resolveProvider(provider);
    const row = await adapter.fetchEntity(entityId);
    if (!row || typeof row !== 'object') return null;
    return {
      id: String(row.id || entityId),
      name: row.name || null,
      slug: row.slug || null,
      entityType: row.entityType || row.type || null,
      parentId: row.parentId || null,
      destinationId: row.destinationId || null,
      parkId: row.parkId || null,
      timezone: row.timezone || null,
      externalId: row.externalId || null,
      location: row.location || null,
      raw: row,
    };
  }

  /**
   * GET /v1/entity/{id}/children via provider adapter (themeparks.wiki, …).
   */
  async listProviderEntityChildren(provider, entityId) {
    const adapter = await this.resolveProvider(provider);
    if (typeof adapter.fetchEntities !== 'function') {
      throw new AppError('Entity children not supported for this provider', 501, {
        code: 'NOT_SUPPORTED',
      });
    }
    const raw = await adapter.fetchEntities(entityId);
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.children)) return raw.children;
      if (Array.isArray(raw.data)) return raw.data;
      if (Array.isArray(raw.items)) return raw.items;
    }
    return [];
  }

  async getProviderEntityLive(provider, entityId) {
    const adapter = await this.resolveProvider(provider);
    const row = await adapter.fetchEntityLive(entityId);
    return row || null;
  }

  async getProviderEntitySchedule(provider, entityId, options = {}) {
    const adapter = await this.resolveProvider(provider);
    const row = await adapter.fetchEntitySchedule(entityId, options);
    return row || null;
  }
}

module.exports = {
  ProviderBrowserService,
  // Pure helpers exported for unit tests and (in C3.7) the canonical
  // ingestion pipeline service.
  normalizeDestinationAndParkRows,
  listFromProviderPayload,
  normalizedEntityType,
  isParkEntity,
  isDestinationEntity,
  asArray,
};
