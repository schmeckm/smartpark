const { AppError } = require('../utils/app-error');
const { logger } = require('../utils/logger');
const { ProviderAdapterRegistryService } = require('./provider-adapter-registry.service');
const { CanonicalInboundMessageService } = require('./canonical-inbound-message.service');
const { AppSettingRepository } = require('../repositories/app-setting.repository');
const { ExternalEntityMappingService } = require('./external-entity-mapping.service');
const { ManualUnsNodeService } = require('../modules/integrations/orchestrator/manual-uns-node.service');
const { ProviderBrowserService } = require('../modules/integrations/orchestrator/provider-browser.service');
const {
  IntegrationSettingsService,
  INTEGRATION_SETTING_KEYS,
} = require('../modules/integrations/orchestrator/integration-settings.service');
const {
  SparkplugTopicSchemaService,
} = require('../modules/integrations/orchestrator/sparkplug-topic-schema.service');
const {
  UnsTopicSuggestionService,
} = require('../modules/integrations/orchestrator/uns-topic-suggestion.service');
const { emitExternalMappingUpdated, emitExternalParkDataUpdated } = require('../sockets');
const env = require('../config/env');
const { getPlatformSettingsService } = require('./platform-settings.service');
const { generateTopicPath, buildCanonicalUnsTopic } = require('../modules/uns/uns-topic-generator.service');
const { enrichRowsWithSparkplug } = require('../modules/uns/sparkplug-topic-builder.service');
const { getCanonicalToSparkplugPublisher } = require('./canonicalToSparkplugPublisher');
const {
  resolveThemeParksPublicationDomain,
  mergeThemeParksEntityRegistryFromMessages,
  mergeThemeParksEntityRegistryFromLiveMessages,
} = require('../modules/uns/theme-parks-entity-domain.service');
const { slugifyName } = require('../utils/slugify.util');

/**
 * Phase C3.3 — `SETTING_KEYS` is now owned by the extracted
 * IntegrationSettingsService as `INTEGRATION_SETTING_KEYS`. Re-exported
 * here under its historical name for backward compatibility with
 * downstream callers that imported it from this module.
 */
const SETTING_KEYS = INTEGRATION_SETTING_KEYS;

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
    this.integrationSettings = new IntegrationSettingsService({
      settingRepository: this.settingRepository,
      registryService: this.registryService,
      unsParkKeyResolver: async () => this.resolveUnsParkKey(),
    });
    this.unsTopicSuggestion = new UnsTopicSuggestionService({
      selectedParkResolver: () => this.selectedParkOrThrow(),
      providerEntityResolver: (provider, entityId) => this.getProviderEntity(provider, entityId),
      manualNodeService: this.manualUnsNodeService,
      mappingService: this.mappingService,
      canonicalService: this.canonicalService,
      settingRepository: this.settingRepository,
    });
    this.sparkplugSchema = new SparkplugTopicSchemaService({
      settingRepository: this.settingRepository,
      selectedParkResolver: () => this.selectedParkOrThrow(),
      parkSlugResolver: async (selected) => {
        const parkEntity = await this.getProviderEntity(selected.provider, selected.externalParkId);
        return slugifyName(parkEntity?.name || selected.parkName || selected.externalParkId);
      },
      dynamicTopicRowsResolver: (selected, parkSlug) =>
        this.unsTopicSuggestion.buildDynamicUnsTopicNodesFromIntegrations(selected, parkSlug),
    });
  }

  bootstrap() {
    return this.integrationSettings.seedDefaults();
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

  getSettings() {
    return this.integrationSettings.get();
  }

  patchSettings(input) {
    return this.integrationSettings.patch(input);
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

  /* C3.5: removed `listCanonicalMessages`, `getCanonicalMessage`, and
   * `reprocessCanonicalMessage`. They were thin pass-throughs to
   * `this.canonicalService.{list,findById,reprocess}`. The
   * integrations controller now uses `CanonicalInboundMessageService`
   * directly; internal ingestion code already calls
   * `this.canonicalService.ingest()` without going through a wrapper. */

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

  buildDynamicUnsTopicNodesFromIntegrations(selected, parkSlug) {
    return this.unsTopicSuggestion.buildDynamicUnsTopicNodesFromIntegrations(selected, parkSlug);
  }

  /** Flat rows for persisting into `uns_nodes` (no Sparkplug enrichment). */
  getUnsTopicSuggestionFlatRows() {
    return this.unsTopicSuggestion.getFlatRows();
  }

  materializeUnsNodesFromSuggestions() {
    return this.unsTopicSuggestion.materializeFromSuggestions();
  }

  getUnsTopicSuggestions() {
    return this.unsTopicSuggestion.getSuggestions();
  }

  getSparkplugTopicSchemaDocument({ source }) {
    return this.sparkplugSchema.get({ source });
  }

  putSparkplugTopicSchemaDocument(doc) {
    return this.sparkplugSchema.put(doc);
  }

  deleteSparkplugTopicSchemaDocument() {
    return this.sparkplugSchema.delete();
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
