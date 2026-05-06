const { AppError } = require('../utils/app-error');
const { logger } = require('../utils/logger');
const { randomUUID } = require('node:crypto');
const { ProviderAdapterRegistryService } = require('./provider-adapter-registry.service');
const { CanonicalInboundMessageService } = require('./canonical-inbound-message.service');
const { AppSettingRepository } = require('../repositories/app-setting.repository');
const { ExternalEntityMappingService } = require('./external-entity-mapping.service');
const { emitExternalMappingUpdated, emitExternalParkDataUpdated } = require('../sockets');
const { DEFAULT_AI_FACTOR_CONFIGS } = require('../constants/ai-factor-config');
const env = require('../config/env');
const { getPlatformSettingsService } = require('./platform-settings.service');
const { generateTopicPath, buildCanonicalUnsTopic } = require('../modules/uns/uns-topic-generator.service');
const { enrichRowsWithSparkplug } = require('../modules/uns/sparkplug-topic-builder.service');
const { getCanonicalToSparkplugPublisher } = require('./canonicalToSparkplugPublisher');
const {
  resolveThemeParksPublicationDomain,
  loadEntityDomainRegistry,
  mergeThemeParksEntityRegistryFromMessages,
  mergeThemeParksEntityRegistryFromLiveMessages,
} = require('../modules/uns/theme-parks-entity-domain.service');

const SETTING_KEYS = {
  selectedProvider: 'externalParkData.selectedProvider',
  selectedDestination: 'externalParkData.selectedDestination',
  selectedPark: 'externalParkData.selectedPark',
  autoApplyEnabled: 'externalParkData.autoApplyEnabled',
  pollingEnabled: 'externalParkData.pollingEnabled',
  pollingIntervalSeconds: 'externalParkData.pollingIntervalSeconds',
  aiForecastFactors: 'ai.forecast.factorConfigs',
  unsManualNodes: 'uns.manualNodes',
  unsSparkplugSchemaOverride: 'uns.sparkplugTopicSchema',
};

function slugifyName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
}

function resolveUnsDomainForEntity(entityName, entityType) {
  return resolveThemeParksPublicationDomain(entityName, entityType);
}

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

function normalizeDestinationAndParkRows(raw) {
  const destinationById = new Map();
  const parkById = new Map();
  const seen = new WeakSet();
  const roots = asArray(raw);
  const queue = roots.length ? roots.map((row) => ({ row, destinationCtx: null })) : [{ row: raw, destinationCtx: null }];

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
    if (isDestinationEntity(row) || (!isParkEntity(row) && (Array.isArray(row.parks) || Array.isArray(row.children)))) {
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

class IntegrationOrchestratorService {
  constructor() {
    this.registryService = new ProviderAdapterRegistryService();
    this.canonicalService = new CanonicalInboundMessageService();
    this.settingRepository = new AppSettingRepository();
    this.mappingService = new ExternalEntityMappingService();
  }

  async bootstrap() {
    const ps = getPlatformSettingsService();
    await this.registryService.ensureSeedConfigs();
    await this.settingRepository.upsertValue(SETTING_KEYS.selectedProvider, {
      provider: await ps.getString('EXTERNAL_PARK_DATA_DEFAULT_PROVIDER', 'themeparks_wiki'),
    });
    await this.settingRepository.upsertValue(SETTING_KEYS.autoApplyEnabled, { enabled: true });
    // Do not overwrite polling flags on every restart — users enable them in Integration settings.
    if (!(await this.settingRepository.findByKey(SETTING_KEYS.pollingEnabled))) {
      await this.settingRepository.upsertValue(SETTING_KEYS.pollingEnabled, {
        enabled: await ps.getBoolean('EXTERNAL_PARK_DATA_ENABLED', true),
      });
    }
    if (!(await this.settingRepository.findByKey(SETTING_KEYS.pollingIntervalSeconds))) {
      await this.settingRepository.upsertValue(SETTING_KEYS.pollingIntervalSeconds, {
        seconds: await ps.getNumber('EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS', 300),
      });
    }
    const existingFactors = await this.settingRepository.getValue(SETTING_KEYS.aiForecastFactors, null);
    if (!Array.isArray(existingFactors) || !existingFactors.length) {
      await this.settingRepository.upsertValue(SETTING_KEYS.aiForecastFactors, DEFAULT_AI_FACTOR_CONFIGS);
    }
    await loadEntityDomainRegistry(this.settingRepository);
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
   * UNS tree/topics/live filter by this key (DB `uns_nodes.park_id`, MQTT segment after `tpuns/`).
   * Must match `getUnsTopicSuggestions` / topic paths — not the provider's external park UUID.
   */
  async resolveUnsParkKey() {
    const park = await this.settingRepository.getValue(SETTING_KEYS.selectedPark, null);
    if (!park?.externalParkId || !park?.provider) {
      return 'europa_park';
    }
    if (park.parkName && String(park.parkName).trim()) {
      return slugifyName(park.parkName);
    }
    try {
      const parkEntity = await this.getProviderEntity(park.provider, park.externalParkId);
      return slugifyName(parkEntity?.name || park.externalParkId);
    } catch (e) {
      logger.warn({ err: e.message }, 'resolveUnsParkKey: provider entity failed');
      return slugifyName(park.externalParkId);
    }
  }

  async getSettings() {
    const unsParkKey = await this.resolveUnsParkKey();
    const selectedPark = await this.settingRepository.getValue(SETTING_KEYS.selectedPark, null);
    const overrideSnap = await this.settingRepository.getValue(SETTING_KEYS.unsSparkplugSchemaOverride, null);
    const overrideActive = Boolean(
      overrideSnap?.entries?.length &&
        selectedPark?.provider &&
        selectedPark?.externalParkId &&
        overrideSnap.provider === selectedPark.provider &&
        overrideSnap.externalParkId === selectedPark.externalParkId
    );
    return {
      selectedProvider: await this.settingRepository.getValue(SETTING_KEYS.selectedProvider, { provider: 'themeparks_wiki' }),
      selectedDestination: await this.settingRepository.getValue(SETTING_KEYS.selectedDestination, null),
      selectedPark,
      unsParkKey,
      unsTopicSchemaOverrideSummary: {
        active: overrideActive,
        entryCount: overrideActive ? overrideSnap.entries.length : 0,
        updatedAt: overrideSnap?.updatedAt || null,
      },
      autoApplyEnabled: await this.settingRepository.getValue(SETTING_KEYS.autoApplyEnabled, { enabled: true }),
      pollingEnabled: await this.settingRepository.getValue(SETTING_KEYS.pollingEnabled, { enabled: false }),
      pollingIntervalSeconds: await this.settingRepository.getValue(SETTING_KEYS.pollingIntervalSeconds, { seconds: 300 }),
      aiForecastFactors: await this.settingRepository.getValue(SETTING_KEYS.aiForecastFactors, DEFAULT_AI_FACTOR_CONFIGS),
    };
  }

  async patchSettings(input) {
    const settings = await this.getSettings();
    if (Object.hasOwn(input, 'selectedProvider')) {
      await this.settingRepository.upsertValue(SETTING_KEYS.selectedProvider, input.selectedProvider);
      settings.selectedProvider = input.selectedProvider;
    }
    if (Object.hasOwn(input, 'selectedDestination')) {
      if (input.selectedDestination == null) {
        await this.settingRepository.deleteByKey(SETTING_KEYS.selectedDestination);
      } else {
        await this.settingRepository.upsertValue(SETTING_KEYS.selectedDestination, input.selectedDestination);
      }
      settings.selectedDestination = input.selectedDestination;
    }
    if (Object.hasOwn(input, 'selectedPark')) {
      if (input.selectedPark == null) {
        await this.settingRepository.deleteByKey(SETTING_KEYS.selectedPark);
      } else {
        await this.settingRepository.upsertValue(SETTING_KEYS.selectedPark, input.selectedPark);
      }
      settings.selectedPark = input.selectedPark;
    }
    if (Object.hasOwn(input, 'autoApplyEnabled')) {
      await this.settingRepository.upsertValue(SETTING_KEYS.autoApplyEnabled, input.autoApplyEnabled);
      settings.autoApplyEnabled = input.autoApplyEnabled;
    }
    if (Object.hasOwn(input, 'pollingEnabled')) {
      await this.settingRepository.upsertValue(SETTING_KEYS.pollingEnabled, input.pollingEnabled);
      settings.pollingEnabled = input.pollingEnabled;
    }
    if (Object.hasOwn(input, 'pollingIntervalSeconds')) {
      await this.settingRepository.upsertValue(SETTING_KEYS.pollingIntervalSeconds, input.pollingIntervalSeconds);
      settings.pollingIntervalSeconds = input.pollingIntervalSeconds;
    }
    if (Object.hasOwn(input, 'aiForecastFactors')) {
      await this.settingRepository.upsertValue(SETTING_KEYS.aiForecastFactors, input.aiForecastFactors);
      settings.aiForecastFactors = input.aiForecastFactors;
    }
    return this.getSettings();
  }

  async resolveProvider(provider) {
    const p = provider || (await this.settingRepository.getValue(SETTING_KEYS.selectedProvider, { provider: 'themeparks_wiki' })).provider;
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
    const destinations = normalized.destinations.length ? normalized.destinations : await this.listAvailableDestinations(provider);
    let resolvedDestinationId = destinationId;
    if (!resolvedDestinationId) {
      const selectedDestination = await this.settingRepository.getValue(SETTING_KEYS.selectedDestination, null);
      if (selectedDestination?.provider === adapter.getProviderInfo().provider) {
        resolvedDestinationId = selectedDestination.externalDestinationId;
      }
    }

    if (normalized.parks.length) {
      return normalized.parks
        .filter((p) => !resolvedDestinationId || String(p.destinationId || '') === String(resolvedDestinationId))
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
   * GET /v1/entity/{id}/children via provider adapter (ThemeParks.wiki, …).
   */
  async listProviderEntityChildren(provider, entityId) {
    const adapter = await this.resolveProvider(provider);
    if (typeof adapter.fetchEntities !== 'function') {
      throw new AppError('Entity children not supported for this provider', 501, { code: 'NOT_SUPPORTED' });
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

  async syncDestinations(provider) {
    const adapter = await this.resolveProvider(provider);
    const data = await adapter.fetchDestinations();
    const msgs = adapter.normalizeToCanonicalMessages({ type: 'destinations', items: data });
    const autoApplyEnabled = await this.settingRepository.getValue(SETTING_KEYS.autoApplyEnabled, { enabled: true });
    const rows = await this.canonicalService.ingest(msgs, { autoApply: autoApplyEnabled.enabled !== false });
    try {
      for (const m of msgs) {
        if (m.messageType !== 'DESTINATION_SYNCED') continue;
        const p = m.payload || {};
        const destGid = slugifyName(p.name || p.externalDestinationId || p.id || 'destination');
        mergeThemeParksEntityRegistryFromMessages({
          sparkplugGroupId: destGid,
          parkExternalId: null,
          destinationExternalId: String(p.externalDestinationId || p.id || ''),
          messages: [m],
        });
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'themeParks entity registry merge after destination sync failed');
    }
    return { count: rows.length, provider: adapter.getProviderInfo().provider };
  }

  async syncParks(provider, destinationId) {
    const adapter = await this.resolveProvider(provider);
    let resolvedDestinationId = destinationId;
    if (!resolvedDestinationId) {
      const selectedDestination = await this.settingRepository.getValue(SETTING_KEYS.selectedDestination, null);
      if (selectedDestination?.provider === adapter.getProviderInfo().provider) {
        resolvedDestinationId = selectedDestination.externalDestinationId;
      }
    }
    if (!resolvedDestinationId) {
      throw new AppError('No destination selected for park sync', 422, { code: 'VALIDATION_ERROR' });
    }
    const data = await adapter.fetchParks(resolvedDestinationId);
    const msgs = adapter.normalizeToCanonicalMessages({
      type: 'parks',
      destinationId: resolvedDestinationId,
      items: data,
    });
    const autoApplyEnabled = await this.settingRepository.getValue(SETTING_KEYS.autoApplyEnabled, { enabled: true });
    const rows = await this.canonicalService.ingest(msgs, { autoApply: autoApplyEnabled.enabled !== false });
    try {
      for (const m of msgs) {
        if (m.messageType !== 'PARK_SYNCED') continue;
        const p = m.payload || {};
        const parkGid = slugifyName(p.name || p.externalParkId || '');
        mergeThemeParksEntityRegistryFromMessages({
          sparkplugGroupId: parkGid,
          parkExternalId: String(p.externalParkId || m.externalParkId || ''),
          destinationExternalId: String(resolvedDestinationId || p.externalDestinationId || ''),
          messages: [m],
        });
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'themeParks entity registry merge after park sync failed');
    }
    return { count: rows.length, provider: adapter.getProviderInfo().provider };
  }

  async selectedParkOrThrow() {
    const park = await this.settingRepository.getValue(SETTING_KEYS.selectedPark, null);
    if (!park?.externalParkId || !park?.provider) {
      throw new AppError('No selected park configured', 422, { code: 'VALIDATION_ERROR' });
    }
    return park;
  }

  async syncEntities(provider, parkId) {
    const selected = parkId ? { provider, externalParkId: parkId } : await this.selectedParkOrThrow();
    const adapter = await this.resolveProvider(selected.provider);
    const data = await adapter.fetchEntities(selected.externalParkId);
    const msgs = adapter.normalizeToCanonicalMessages({ type: 'entities', parkId: selected.externalParkId, items: data });
    const autoApplyEnabled = await this.settingRepository.getValue(SETTING_KEYS.autoApplyEnabled, { enabled: true });
    const rows = await this.canonicalService.ingest(msgs, { autoApply: autoApplyEnabled.enabled !== false });

    try {
      const parkEntity = await this.getProviderEntity(selected.provider, selected.externalParkId);
      const parkSlug = slugifyName(parkEntity?.name || selected.parkName || selected.externalParkId);
      const sparkplugGroupId = env.sparkplugGroupId || parkSlug;
      mergeThemeParksEntityRegistryFromMessages({
        sparkplugGroupId,
        parkExternalId: String(selected.externalParkId),
        destinationExternalId: parkEntity?.destinationId != null ? String(parkEntity.destinationId) : null,
        messages: msgs,
      });
      await getCanonicalToSparkplugPublisher().publishFromEntitySyncMessages({
        parkSlug,
        provider: selected.provider,
        messages: msgs,
      });
    } catch (e) {
      logger.warn({ err: e.message }, 'canonicalToSparkplugPublisher after entity sync failed');
    }

    try {
      const savedPark = await this.settingRepository.getValue(SETTING_KEYS.selectedPark, null);
      const matchesSelected =
        savedPark?.externalParkId &&
        String(savedPark.externalParkId) === String(selected.externalParkId) &&
        String(savedPark.provider || '') === String(selected.provider || '');
      if (matchesSelected) {
        await this.materializeUnsNodesFromSuggestions();
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'UNS materialize after entity sync failed');
    }

    let platformMasterData = null;
    if (String(selected.provider || '').toLowerCase() === 'themeparks_wiki' && selected.externalParkId) {
      try {
        const { sequelize, ...models } = require('../models');
        const { syncParkFromThemeParks } = require('../modules/adapters/themeparks/themeparks-sync.service');
        platformMasterData = await syncParkFromThemeParks(sequelize, models, String(selected.externalParkId));
      } catch (e) {
        logger.warn({ err: e.message }, 'platform park_assets sync after integration entity sync failed');
        platformMasterData = { error: e.message };
      }
    }

    return {
      count: rows.length,
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      platformMasterData,
    };
  }

  async syncLive(provider, parkId) {
    const selected = parkId ? { provider, externalParkId: parkId } : await this.selectedParkOrThrow();
    const adapter = await this.resolveProvider(selected.provider);
    const live = await adapter.fetchLiveData(selected.externalParkId);
    const msgs = adapter.normalizeToCanonicalMessages({ type: 'live', parkId: selected.externalParkId, items: live });
    const autoApplyEnabled = await this.settingRepository.getValue(SETTING_KEYS.autoApplyEnabled, { enabled: true });
    const rows = await this.canonicalService.ingest(msgs, { autoApply: autoApplyEnabled.enabled !== false });

    try {
      const parkEntity = await this.getProviderEntity(selected.provider, selected.externalParkId);
      const parkSlug = slugifyName(parkEntity?.name || selected.parkName || selected.externalParkId);
      const sparkplugGroupId = env.sparkplugGroupId || parkSlug;
      mergeThemeParksEntityRegistryFromLiveMessages({
        sparkplugGroupId,
        parkExternalId: String(selected.externalParkId),
        destinationExternalId: parkEntity?.destinationId != null ? String(parkEntity.destinationId) : null,
        messages: msgs,
      });
      await getCanonicalToSparkplugPublisher().publishFromLiveCanonicalMessages({
        parkSlug,
        provider: selected.provider,
        messages: msgs,
      });
    } catch (e) {
      logger.warn({ err: e.message }, 'canonicalToSparkplugPublisher after live sync failed');
    }

    emitExternalParkDataUpdated({
      provider: selected.provider,
      park: selected.externalParkId,
      sampledAt: new Date().toISOString(),
      messageCount: rows.length,
    });

    let platformLive = null;
    if (String(selected.provider || '').toLowerCase() === 'themeparks_wiki' && selected.externalParkId) {
      try {
        const { sequelize, ...models } = require('../models');
        const { syncThemeParksLiveOnly } = require('../modules/adapters/themeparks/themeparks-sync.service');
        platformLive = await syncThemeParksLiveOnly(sequelize, models, String(selected.externalParkId));
      } catch (e) {
        logger.warn({ err: e.message }, 'platform live observations sync after integration live sync failed');
        platformLive = { error: e.message };
      }
    }

    return {
      count: rows.length,
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      platformLive,
    };
  }

  async syncCalendar(provider, parkId, options = {}) {
    const selected = parkId ? { provider, externalParkId: parkId } : await this.selectedParkOrThrow();
    const adapter = await this.resolveProvider(selected.provider);
    const cal = await adapter.fetchCalendar(selected.externalParkId, options);
    const msgs = adapter.normalizeToCanonicalMessages({ type: 'calendar', parkId: selected.externalParkId, items: cal });
    const autoApplyEnabled = await this.settingRepository.getValue(SETTING_KEYS.autoApplyEnabled, { enabled: true });
    const rows = await this.canonicalService.ingest(msgs, { autoApply: autoApplyEnabled.enabled !== false });

    if (typeof adapter.fetchCrowdLevel === 'function') {
      try {
        const crowd = await adapter.fetchCrowdLevel(selected.externalParkId);
        const crowdMsgs = adapter.normalizeToCanonicalMessages({
          type: 'crowd',
          parkId: selected.externalParkId,
          items: crowd,
        });
        await this.canonicalService.ingest(crowdMsgs, { autoApply: autoApplyEnabled.enabled !== false });
      } catch (e) {
        logger.warn({ err: e.message, provider: selected.provider }, 'crowd sync failed');
      }
    }
    return { count: rows.length, provider: selected.provider, externalParkId: selected.externalParkId };
  }

  async syncAllParksInDestination(provider, destinationId) {
    const parks = await this.listAvailableParks(provider, destinationId);
    if (!parks.length) {
      throw new AppError('No parks found for selected destination', 422, { code: 'VALIDATION_ERROR' });
    }

    const summary = {
      provider,
      destinationId: destinationId || null,
      parksTotal: parks.length,
      parksProcessed: 0,
      entitiesMessages: 0,
      calendarMessages: 0,
      liveMessages: 0,
      failedParks: [],
    };

    for (const park of parks) {
      try {
        const entities = await this.syncEntities(provider, park.id);
        const calendar = await this.syncCalendar(provider, park.id);
        const live = await this.syncLive(provider, park.id);
        summary.parksProcessed += 1;
        summary.entitiesMessages += entities.count || 0;
        summary.calendarMessages += calendar.count || 0;
        summary.liveMessages += live.count || 0;
      } catch (error) {
        summary.failedParks.push({
          parkId: park.id,
          parkName: park.name,
          error: error?.message || 'Unknown error',
        });
      }
    }

    return summary;
  }

  listCanonicalMessages(filters) {
    return this.canonicalService.list(filters);
  }

  getCanonicalMessage(id) {
    return this.canonicalService.findById(id);
  }

  reprocessCanonicalMessage(id) {
    return this.canonicalService.reprocess(id);
  }

  listMappings(filters) {
    return this.mappingService.listMappings(filters);
  }

  async patchMapping(id, patch) {
    const row = await this.mappingService.patchMapping(id, patch);
    if (row) emitExternalMappingUpdated(row.toJSON ? row.toJSON() : row);
    return row;
  }

  async listManualUnsNodes() {
    const selected = await this.selectedParkOrThrow();
    const all = await this.settingRepository.getValue(SETTING_KEYS.unsManualNodes, []);
    if (!Array.isArray(all)) return [];
    return all.filter(
      (r) => r && r.provider === selected.provider && r.externalParkId === selected.externalParkId
    );
  }

  async addManualUnsNode(input) {
    const selected = await this.selectedParkOrThrow();
    const all = await this.settingRepository.getValue(SETTING_KEYS.unsManualNodes, []);
    const rows = Array.isArray(all) ? all : [];
    const et = input.entityType != null && String(input.entityType).trim() !== '' ? String(input.entityType).trim().toUpperCase() : null;
    const row = {
      id: randomUUID(),
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      domain:
        input.domain != null && String(input.domain).trim() !== ''
          ? slugifyName(input.domain)
          : resolveUnsDomainForEntity(null, et),
      assetSlug: slugifyName(input.assetSlug || input.assetName),
      metric: slugifyName(input.metric),
      assetName: input.assetName || input.assetSlug,
      entityType: et,
      source: 'MANUAL',
      createdAt: new Date().toISOString(),
    };
    rows.push(row);
    await this.settingRepository.upsertValue(SETTING_KEYS.unsManualNodes, rows);
    return row;
  }

  async removeManualUnsNode(id) {
    const selected = await this.selectedParkOrThrow();
    const all = await this.settingRepository.getValue(SETTING_KEYS.unsManualNodes, []);
    const rows = Array.isArray(all) ? all : [];
    const next = rows.filter(
      (r) => !(r && r.id === id && r.provider === selected.provider && r.externalParkId === selected.externalParkId)
    );
    await this.settingRepository.upsertValue(SETTING_KEYS.unsManualNodes, next);
    return rows.length !== next.length;
  }

  _unsSchemaMatchesPark(doc, selected) {
    return String(doc?.provider) === String(selected.provider) && String(doc?.externalParkId) === String(selected.externalParkId);
  }

  _applyUploadedUnsSchemaEntries(entries, selected, parkSlug) {
    return entries.map((e) => {
      const assetSlug = slugifyName(e.assetSlug);
      const metric = slugifyName(e.metric);
      const customSp = e.sparkplugTopic && String(e.sparkplugTopic).trim() ? String(e.sparkplugTopic).trim() : undefined;
      const et = e.entityType != null && String(e.entityType).trim() !== '' ? String(e.entityType).trim().toUpperCase() : null;
      const resolvedDomain =
        e.domain != null && String(e.domain).trim() !== ''
          ? slugifyName(e.domain)
          : resolveUnsDomainForEntity(null, et);
      return {
        provider: selected.provider,
        externalParkId: selected.externalParkId,
        externalEntityId: e.externalEntityId != null && e.externalEntityId !== '' ? String(e.externalEntityId) : null,
        entityName: e.entityName || assetSlug,
        entityType: et,
        domain: resolvedDomain,
        assetSlug,
        metric,
        topicPath:
          e.topicPath && String(e.topicPath).trim()
            ? String(e.topicPath).trim()
            : generateTopicPath({ parkSlug, version: 'v1', domain: resolvedDomain, assetSlug, metric }),
        sparkplugTopic: customSp,
        source: 'SCHEMA_UPLOAD',
      };
    });
  }

  async buildDynamicUnsTopicNodesFromIntegrations(selected, parkSlug) {
    const [mappings, messages] = await Promise.all([
      this.mappingService.listMappings({
        provider: selected.provider,
        parkId: selected.externalParkId,
      }),
      this.canonicalService.list({
        provider: selected.provider,
        externalParkId: selected.externalParkId,
        limit: 500,
        offset: 0,
      }),
    ]);

    const nodesByEntity = new Map();
    for (const m of mappings) {
      const met = m.externalEntityType != null && String(m.externalEntityType).trim() !== '' ? String(m.externalEntityType).trim().toUpperCase() : null;
      nodesByEntity.set(m.externalEntityId, {
        externalEntityId: m.externalEntityId,
        entityName: m.externalEntityName || m.externalEntityId,
        assetSlug: slugifyName(m.externalEntityName || m.externalEntityId),
        entityType: met,
        domain: resolveUnsDomainForEntity(null, met),
        metrics: new Set(),
        source: 'MAPPING',
      });
    }
    for (const msg of messages) {
      if (!msg.externalEntityId) continue;
      if (!['WAIT_TIME_UPDATED', 'ENTITY_STATUS_UPDATED'].includes(msg.messageType)) continue;
      const payload = msg.payload || {};
      const metric = msg.messageType === 'WAIT_TIME_UPDATED' ? 'queue_time' : 'status';
      if (!nodesByEntity.has(msg.externalEntityId)) {
        const etRaw = payload.entityType || msg.entityType;
        const et = etRaw != null && String(etRaw).trim() !== '' ? String(etRaw).trim().toUpperCase() : null;
        const assetSlug = slugifyName(payload.slug || payload.externalEntityName || msg.externalEntityId);
        nodesByEntity.set(msg.externalEntityId, {
          externalEntityId: msg.externalEntityId,
          entityName: payload.externalEntityName || msg.externalEntityId,
          assetSlug,
          entityType: et,
          domain: resolveUnsDomainForEntity(null, et),
          metrics: new Set(),
          source: 'CANONICAL',
        });
      }
      nodesByEntity.get(msg.externalEntityId).metrics.add(metric);
    }

    const integrationNodes = [...nodesByEntity.values()].flatMap((n) => {
      const metrics = n.metrics.size ? [...n.metrics] : ['status', 'queue_time'];
      return metrics.map((metric) => ({
        provider: selected.provider,
        externalParkId: selected.externalParkId,
        externalEntityId: n.externalEntityId,
        entityName: n.entityName,
        entityType: n.entityType,
        domain: n.domain,
        assetSlug: n.assetSlug,
        metric,
        topicPath: buildCanonicalUnsTopic({
          parkSlug,
          entityType: n.domain,
          entitySlug: n.assetSlug,
          metric,
        }),
        source: n.source,
      }));
    });

    let masterRows = [];
    try {
      const { generateUnsTopicRowsFromMasterData } = require('../modules/uns/uns-master-data-generation.service');
      masterRows = await generateUnsTopicRowsFromMasterData({
        provider: selected.provider,
        externalParkId: selected.externalParkId,
        parkSlug,
      });
    } catch (e) {
      logger.warn({ err: e.message }, 'UNS: master-data topic rows skipped');
    }

    const byPath = new Map();
    for (const r of integrationNodes) {
      byPath.set(r.topicPath, r);
    }
    for (const r of masterRows) {
      byPath.set(r.topicPath, r);
    }
    return [...byPath.values()];
  }

  async _buildUnsSuggestionCore() {
    const selected = await this.selectedParkOrThrow();
    const parkEntity = await this.getProviderEntity(selected.provider, selected.externalParkId);
    const parkSlug = slugifyName(parkEntity?.name || selected.parkName || selected.externalParkId);

    const [manualNodes, storedOverride] = await Promise.all([
      this.listManualUnsNodes(),
      this.settingRepository.getValue(SETTING_KEYS.unsSparkplugSchemaOverride, null),
    ]);

    let dynamicNodes = await this.buildDynamicUnsTopicNodesFromIntegrations(selected, parkSlug);
    let schemaOverrideActive = false;
    const matchedOverride =
      storedOverride?.entries?.length && this._unsSchemaMatchesPark(storedOverride, selected) ? storedOverride : null;
    if (matchedOverride) {
      dynamicNodes = this._applyUploadedUnsSchemaEntries(matchedOverride.entries, selected, parkSlug);
      schemaOverrideActive = true;
    }

    const manualRows = manualNodes.map((m) => ({
      id: m.id,
      provider: m.provider,
      externalParkId: m.externalParkId,
      externalEntityId: null,
      entityName: m.assetName || m.assetSlug,
      entityType: m.entityType,
      domain: m.domain,
      assetSlug: m.assetSlug,
      metric: m.metric,
      topicPath: buildCanonicalUnsTopic({
        parkSlug,
        entityType: m.domain,
        entitySlug: m.assetSlug,
        metric: m.metric,
      }),
      source: 'MANUAL',
    }));

    return {
      selected,
      parkSlug,
      dynamicNodes,
      manualNodes,
      manualRows,
      schemaOverrideActive,
      matchedOverride,
    };
  }

  /** Flat rows for persisting into `uns_nodes` (no Sparkplug enrichment). */
  async getUnsTopicSuggestionFlatRows() {
    const core = await this._buildUnsSuggestionCore();
    return { parkSlug: core.parkSlug, rows: [...core.dynamicNodes, ...core.manualRows] };
  }

  async materializeUnsNodesFromSuggestions() {
    const { UnsService } = require('../modules/uns/uns.service');
    const { parkSlug, rows } = await this.getUnsTopicSuggestionFlatRows();
    const lean = rows.map((r) => ({
      topicPath: r.topicPath,
      domain: r.domain,
      assetSlug: r.assetSlug,
      metric: r.metric,
      entityName: r.entityName,
      entityType: r.entityType,
      source: r.source,
    }));
    const unsService = new UnsService();
    return unsService.materializeLeavesFromIntegration(parkSlug, lean);
  }

  async getUnsTopicSuggestions() {
    const core = await this._buildUnsSuggestionCore();
    const { selected, parkSlug, dynamicNodes: dynRaw, manualRows, manualNodes, schemaOverrideActive, matchedOverride } =
      core;

    const groupId = matchedOverride?.sparkplug?.groupId || env.sparkplugGroupId || parkSlug;
    const edgeNodeId = matchedOverride?.sparkplug?.edgeNodeId || env.sparkplugEdgeNode || 'park_gateway';
    const dynamicNodes = enrichRowsWithSparkplug(dynRaw, { groupId, edgeNodeId });
    const manual = enrichRowsWithSparkplug(manualRows, { groupId, edgeNodeId });

    const all = [...dynamicNodes, ...manual].sort((a, b) => a.topicPath.localeCompare(b.topicPath));
    const byDomain = new Map();
    for (const n of all) {
      if (!byDomain.has(n.domain)) byDomain.set(n.domain, []);
      byDomain.get(n.domain).push(n);
    }
    const tree = [...byDomain.entries()].map(([domain, items]) => ({ domain, items }));

    return {
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      parkSlug,
      schemaOverrideActive,
      sparkplug: { groupId, edgeNodeId },
      tree,
      totalTopics: all.length,
      dynamicTopics: dynRaw.length,
      manualTopics: manualNodes.length,
    };
  }

  async getSparkplugTopicSchemaDocument({ source }) {
    const selected = await this.selectedParkOrThrow();
    const parkEntity = await this.getProviderEntity(selected.provider, selected.externalParkId);
    const parkSlug = slugifyName(parkEntity?.name || selected.parkName || selected.externalParkId);
    const defaultGroupId = env.sparkplugGroupId || parkSlug;
    const defaultEdgeNodeId = env.sparkplugEdgeNode || 'park_gateway';

    if (source === 'active') {
      const stored = await this.settingRepository.getValue(SETTING_KEYS.unsSparkplugSchemaOverride, null);
      if (stored?.entries?.length && this._unsSchemaMatchesPark(stored, selected)) {
        const groupId = stored.sparkplug?.groupId || defaultGroupId;
        const edgeNodeId = stored.sparkplug?.edgeNodeId || defaultEdgeNodeId;
        const entries = enrichRowsWithSparkplug([...stored.entries], { groupId, edgeNodeId });
        return {
          schemaVersion: 1,
          kind: 'smartpark.uns.sparkplug_topics',
          provider: selected.provider,
          externalParkId: selected.externalParkId,
          parkSlug: stored.parkSlug || parkSlug,
          updatedAt: stored.updatedAt || null,
          sparkplug: { groupId, edgeNodeId },
          entries,
        };
      }
    }

    const dynamicNodes = await this.buildDynamicUnsTopicNodesFromIntegrations(selected, parkSlug);
    const entries = enrichRowsWithSparkplug(dynamicNodes, {
      groupId: defaultGroupId,
      edgeNodeId: defaultEdgeNodeId,
    });
    return {
      schemaVersion: 1,
      kind: 'smartpark.uns.sparkplug_topics',
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      parkSlug,
      updatedAt: null,
      sparkplug: { groupId: defaultGroupId, edgeNodeId: defaultEdgeNodeId },
      entries,
    };
  }

  async putSparkplugTopicSchemaDocument(doc) {
    const selected = await this.selectedParkOrThrow();
    const parkEntity = await this.getProviderEntity(selected.provider, selected.externalParkId);
    const parkSlug = slugifyName(parkEntity?.name || selected.parkName || selected.externalParkId);
    if (doc.externalParkId && String(doc.externalParkId) !== String(selected.externalParkId)) {
      throw new AppError('Schema externalParkId does not match selected park', 422, { code: 'VALIDATION_ERROR' });
    }
    if (doc.provider && String(doc.provider) !== String(selected.provider)) {
      throw new AppError('Schema provider does not match selected provider', 422, { code: 'VALIDATION_ERROR' });
    }
    const entriesRaw = this._applyUploadedUnsSchemaEntries(doc.entries, selected, parkSlug);
    const groupId = doc.sparkplug?.groupId || env.sparkplugGroupId || parkSlug;
    const edgeNodeId = doc.sparkplug?.edgeNodeId || env.sparkplugEdgeNode || 'park_gateway';
    const entries = enrichRowsWithSparkplug(entriesRaw, { groupId, edgeNodeId });
    const normalized = {
      schemaVersion: 1,
      kind: 'smartpark.uns.sparkplug_topics',
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      parkSlug: doc.parkSlug ? String(doc.parkSlug) : parkSlug,
      updatedAt: new Date().toISOString(),
      sparkplug: { groupId, edgeNodeId },
      entries,
    };
    await this.settingRepository.upsertValue(SETTING_KEYS.unsSparkplugSchemaOverride, normalized);
    return { entryCount: normalized.entries.length };
  }

  async deleteSparkplugTopicSchemaDocument() {
    await this.settingRepository.deleteByKey(SETTING_KEYS.unsSparkplugSchemaOverride);
  }

  /**
   * Polls live data when integration polling is on **and** platform `EXTERNAL_PARK_DATA_ENABLED` is true.
   * Interval follows **app_settings** (`pollingIntervalSeconds`); platform setting seeds defaults at bootstrap.
   */
  startPollingIfEnabled() {
    let cancelled = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const loop = async () => {
      while (!cancelled) {
        let waitMs = 60_000;
        try {
          const ps = getPlatformSettingsService();
          const pe = await this.settingRepository.getValue(SETTING_KEYS.pollingEnabled, { enabled: false });
          const iv = await this.settingRepository.getValue(SETTING_KEYS.pollingIntervalSeconds, {
            seconds: await ps.getNumber('EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS', 300),
          });
          const sec = Math.max(30, Math.min(86400, Number(iv?.seconds) || 300));
          waitMs = sec * 1000;
          const master = await ps.getBoolean('EXTERNAL_PARK_DATA_ENABLED', true);
          if (pe?.enabled && master) {
            await this.syncLive();
          } else if (pe?.enabled && !master) {
            logger.debug(
              { key: SETTING_KEYS.pollingEnabled },
              'external park polling enabled in app_settings but EXTERNAL_PARK_DATA_ENABLED is false — skipping live sync'
            );
          }
        } catch (e) {
          logger.warn({ err: e.message }, 'external integration polling failed');
        }
        await sleep(waitMs);
      }
    };

    void loop();
    return () => {
      cancelled = true;
    };
  }
}

module.exports = { IntegrationOrchestratorService, SETTING_KEYS };
