const { AppError } = require('../utils/app-error');
const { logger } = require('../utils/logger');
const { ProviderAdapterRegistryService } = require('./provider-adapter-registry.service');
const { CanonicalInboundMessageService } = require('./canonical-inbound-message.service');
const { AppSettingRepository } = require('../repositories/app-setting.repository');
const { ExternalEntityMappingService } = require('./external-entity-mapping.service');
const { ManualUnsNodeService } = require('../modules/integrations/orchestrator/manual-uns-node.service');
const { ProviderBrowserService } = require('../modules/integrations/orchestrator/provider-browser.service');
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
const { slugifyName } = require('../utils/slugify.util');

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

function resolveUnsDomainForEntity(entityName, entityType) {
  return resolveThemeParksPublicationDomain(entityName, entityType);
}

/* Phase C3.2: provider-browsing helpers (listFromProviderPayload,
 * normalizedEntityType, isParkEntity, isDestinationEntity, asArray,
 * normalizeDestinationAndParkRows) moved to
 * `src/modules/integrations/orchestrator/provider-browser.service.js`. */

class IntegrationOrchestratorService {
  constructor() {
    this.registryService = new ProviderAdapterRegistryService();
    this.canonicalService = new CanonicalInboundMessageService();
    this.settingRepository = new AppSettingRepository();
    this.mappingService = new ExternalEntityMappingService();
    // Phase C3.x — extracted bounded contexts. Each is a thin domain
    // service composed here so the orchestrator can delegate without
    // changing its public API.
    this.manualUnsNodeService = new ManualUnsNodeService({
      settingRepository: this.settingRepository,
    });
    this.providerBrowser = new ProviderBrowserService({
      registryService: this.registryService,
      settingRepository: this.settingRepository,
    });
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
    return this.providerBrowser.listProviders();
  }

  getProviderConfig(provider) {
    return this.providerBrowser.getProviderConfig(provider);
  }

  patchProviderConfig(provider, patch) {
    return this.providerBrowser.patchProviderConfig(provider, patch);
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

  resolveProvider(provider) {
    return this.providerBrowser.resolveProvider(provider);
  }

  listAvailableDestinations(provider) {
    return this.providerBrowser.listAvailableDestinations(provider);
  }

  listAvailableParks(provider, destinationId) {
    return this.providerBrowser.listAvailableParks(provider, destinationId);
  }

  getProviderEntity(provider, entityId) {
    return this.providerBrowser.getProviderEntity(provider, entityId);
  }

  /**
   * GET /v1/entity/{id}/children via provider adapter (themeparks.wiki, …).
   */
  listProviderEntityChildren(provider, entityId) {
    return this.providerBrowser.listProviderEntityChildren(provider, entityId);
  }

  getProviderEntityLive(provider, entityId) {
    return this.providerBrowser.getProviderEntityLive(provider, entityId);
  }

  getProviderEntitySchedule(provider, entityId, options = {}) {
    return this.providerBrowser.getProviderEntitySchedule(provider, entityId, options);
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
    return this.manualUnsNodeService.list({
      provider: selected.provider,
      externalParkId: selected.externalParkId,
    });
  }

  async addManualUnsNode(input) {
    const selected = await this.selectedParkOrThrow();
    return this.manualUnsNodeService.add({
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      input,
    });
  }

  async removeManualUnsNode(id) {
    const selected = await this.selectedParkOrThrow();
    return this.manualUnsNodeService.remove({
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      id,
    });
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
