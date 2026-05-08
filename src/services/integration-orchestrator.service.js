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
const {
  CanonicalIngestionPipelineService,
} = require('../modules/integrations/orchestrator/canonical-ingestion-pipeline.service');
const {
  IntegrationPollingService,
} = require('../modules/integrations/orchestrator/integration-polling.service');
const { emitExternalMappingUpdated, emitExternalParkDataUpdated } = require('../sockets');
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
    this.ingestionPipeline = new CanonicalIngestionPipelineService({
      settingRepository: this.settingRepository,
      canonicalService: this.canonicalService,
      providerBrowser: this.providerBrowser,
      socketEvents: { emitExternalParkDataUpdated },
      onAfterEntitiesSynced: () => this.materializeUnsNodesFromSuggestions(),
    });
    this.pollingService = new IntegrationPollingService({
      settingRepository: this.settingRepository,
      syncLive: () => this.syncLive(),
      platformSettingsFactory: () => getPlatformSettingsService(),
      settingKeys: SETTING_KEYS,
      logger,
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

  syncDestinations(provider) {
    return this.ingestionPipeline.syncDestinations(provider);
  }

  syncParks(provider, destinationId) {
    return this.ingestionPipeline.syncParks(provider, destinationId);
  }

  selectedParkOrThrow() {
    return this.ingestionPipeline.selectedParkOrThrow();
  }

  syncEntities(provider, parkId) {
    return this.ingestionPipeline.syncEntities(provider, parkId);
  }

  syncLive(provider, parkId) {
    return this.ingestionPipeline.syncLive(provider, parkId);
  }

  syncCalendar(provider, parkId, options = {}) {
    return this.ingestionPipeline.syncCalendar(provider, parkId, options);
  }

  syncAllParksInDestination(provider, destinationId) {
    return this.ingestionPipeline.syncAllParksInDestination(provider, destinationId);
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
   * Polls live data when integration polling is on **and** platform
   * `EXTERNAL_PARK_DATA_ENABLED` is true. Interval follows app_settings
   * (`pollingIntervalSeconds`); the platform setting seeds the default.
   *
   * Phase C3.8 — implementation lives in IntegrationPollingService.
   *
   * @returns {() => void} cancel handle
   */
  startPollingIfEnabled() {
    return this.pollingService.start();
  }
}

module.exports = { IntegrationOrchestratorService, SETTING_KEYS };
