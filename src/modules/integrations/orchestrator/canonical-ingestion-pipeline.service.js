'use strict';

/**
 * Phase C3.7 — extracted from `IntegrationOrchestratorService`.
 *
 * Owns the provider → canonical pipeline:
 *   - `syncDestinations` / `syncParks`           — pre-park sync
 *   - `syncEntities` / `syncLive` / `syncCalendar` — per-park sync
 *   - `syncAllParksInDestination`                — bulk orchestration
 *   - `selectedParkOrThrow`                      — small helper used
 *     by all extracted services, kept here because the pipeline owns
 *     the selectedPark setting (and the orchestrator already
 *     re-exports it for backward compat).
 *
 * The two pre-C3.7 hard-coded `provider equals 'themeparks_wiki'` branches
 * (in `syncEntities` and `syncLive`) are replaced by calls to the
 * post-ingest hook registry. The orchestrator no longer knows about
 * any provider key — adding a new provider only adds a line to
 * `canonical-ingestion-hooks.bootstrap.js`.
 *
 * Lock-in:
 *   - `canonical-ingestion-pipeline.service.test.js` (this commit)
 *   - `integration-orchestrator.service.contract.test.js` (Phase C3.0)
 */

const { AppError } = require('../../../utils/app-error');
const { logger } = require('../../../utils/logger');
const env = require('../../../config/env');
const { slugifyName } = require('../../../utils/slugify.util');
const {
  mergeThemeParksEntityRegistryFromMessages,
  mergeThemeParksEntityRegistryFromLiveMessages,
} = require('../../uns/theme-parks-entity-domain.service');
const {
  getCanonicalToSparkplugPublisher,
} = require('../../../services/canonicalToSparkplugPublisher');
const { canonicalIngestionHooks } = require('./canonical-ingestion-hooks');

// Importing the bootstrap as a side effect ensures every provider
// module (currently: themeparks-sync.service) registers its hooks
// before the first call to runAfterEntities / runAfterLive.
require('./canonical-ingestion-hooks.bootstrap');

const SETTING_KEY_AUTO_APPLY = 'externalParkData.autoApplyEnabled';
const SETTING_KEY_SELECTED_DESTINATION = 'externalParkData.selectedDestination';
const SETTING_KEY_SELECTED_PARK = 'externalParkData.selectedPark';

class CanonicalIngestionPipelineService {
  /**
   * @param {{
   *   settingRepository: { getValue: Function },
   *   canonicalService: { ingest: Function },
   *   providerBrowser: {
   *     resolveProvider: Function,
   *     getProviderEntity: Function,
   *     listAvailableParks: Function,
   *   },
   *   socketEvents?: { emitExternalParkDataUpdated?: Function },
   *   onAfterEntitiesSynced?: (ctx: object) => Promise<void> | void,
   *   hookRegistry?: typeof canonicalIngestionHooks,
   *   sparkplugPublisherFactory?: () => any,
   * }} deps
   */
  constructor(deps = {}) {
    this.settingRepository = deps.settingRepository;
    this.canonicalService = deps.canonicalService;
    this.providerBrowser = deps.providerBrowser;
    this.socketEvents = deps.socketEvents || {};
    this.onAfterEntitiesSynced = deps.onAfterEntitiesSynced || (() => {});
    this.hookRegistry = deps.hookRegistry || canonicalIngestionHooks;
    this.sparkplugPublisherFactory = deps.sparkplugPublisherFactory || getCanonicalToSparkplugPublisher;
  }

  /** Throws 422 unless a selected park exists in app_settings. */
  async selectedParkOrThrow() {
    const park = await this.settingRepository.getValue(SETTING_KEY_SELECTED_PARK, null);
    if (!park?.externalParkId || !park?.provider) {
      throw new AppError('No selected park configured', 422, { code: 'VALIDATION_ERROR' });
    }
    return park;
  }

  async _autoApplyEnabled() {
    const v = await this.settingRepository.getValue(SETTING_KEY_AUTO_APPLY, { enabled: true });
    return v?.enabled !== false;
  }

  async syncDestinations(provider) {
    const adapter = await this.providerBrowser.resolveProvider(provider);
    const data = await adapter.fetchDestinations();
    const msgs = adapter.normalizeToCanonicalMessages({ type: 'destinations', items: data });
    const autoApply = await this._autoApplyEnabled();
    const rows = await this.canonicalService.ingest(msgs, { autoApply });
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
    const adapter = await this.providerBrowser.resolveProvider(provider);
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
    if (!resolvedDestinationId) {
      throw new AppError('No destination selected for park sync', 422, { code: 'VALIDATION_ERROR' });
    }
    const data = await adapter.fetchParks(resolvedDestinationId);
    const msgs = adapter.normalizeToCanonicalMessages({
      type: 'parks',
      destinationId: resolvedDestinationId,
      items: data,
    });
    const autoApply = await this._autoApplyEnabled();
    const rows = await this.canonicalService.ingest(msgs, { autoApply });
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

  async syncEntities(provider, parkId) {
    const selected = parkId ? { provider, externalParkId: parkId } : await this.selectedParkOrThrow();
    const adapter = await this.providerBrowser.resolveProvider(selected.provider);
    const data = await adapter.fetchEntities(selected.externalParkId);
    const msgs = adapter.normalizeToCanonicalMessages({
      type: 'entities',
      parkId: selected.externalParkId,
      items: data,
    });
    const autoApply = await this._autoApplyEnabled();
    const rows = await this.canonicalService.ingest(msgs, { autoApply });

    let parkSlug = null;
    try {
      const parkEntity = await this.providerBrowser.getProviderEntity(
        selected.provider,
        selected.externalParkId
      );
      parkSlug = slugifyName(parkEntity?.name || selected.parkName || selected.externalParkId);
      const sparkplugGroupId = env.sparkplugGroupId || parkSlug;
      mergeThemeParksEntityRegistryFromMessages({
        sparkplugGroupId,
        parkExternalId: String(selected.externalParkId),
        destinationExternalId: parkEntity?.destinationId != null ? String(parkEntity.destinationId) : null,
        messages: msgs,
      });
      await this.sparkplugPublisherFactory().publishFromEntitySyncMessages({
        parkSlug,
        provider: selected.provider,
        messages: msgs,
      });
    } catch (e) {
      logger.warn({ err: e.message }, 'canonicalToSparkplugPublisher after entity sync failed');
    }

    /* Phase C3.7 — UNS materialize callback. The orchestrator wires
     * this to `materializeUnsNodesFromSuggestions` so the pipeline
     * service stays unaware of UnsTopicSuggestionService. */
    try {
      const savedPark = await this.settingRepository.getValue(SETTING_KEY_SELECTED_PARK, null);
      const matchesSelected =
        savedPark?.externalParkId &&
        String(savedPark.externalParkId) === String(selected.externalParkId) &&
        String(savedPark.provider || '') === String(selected.provider || '');
      if (matchesSelected) {
        await this.onAfterEntitiesSynced({ provider: selected.provider, parkSlug, selected });
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'UNS materialize after entity sync failed');
    }

    /* Phase C3.7 — replaces the pre-C3.7 hard-coded provider-equals
     * 'themeparks_wiki' branch. The post-ingest hook registry decides
     * whether a provider needs platform master-data sync; the
     * orchestrator/pipeline no longer knows about any specific provider
     * key. */
    let platformMasterData = null;
    try {
      platformMasterData = await this.hookRegistry.runAfterEntities(selected.provider, {
        externalParkId: selected.externalParkId,
        parkSlug,
        selected,
      });
    } catch (e) {
      logger.warn({ err: e.message }, 'platform park_assets sync after integration entity sync failed');
      platformMasterData = { error: e.message };
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
    const adapter = await this.providerBrowser.resolveProvider(selected.provider);
    const live = await adapter.fetchLiveData(selected.externalParkId);
    const msgs = adapter.normalizeToCanonicalMessages({
      type: 'live',
      parkId: selected.externalParkId,
      items: live,
    });
    const autoApply = await this._autoApplyEnabled();
    const rows = await this.canonicalService.ingest(msgs, { autoApply });

    try {
      const parkEntity = await this.providerBrowser.getProviderEntity(
        selected.provider,
        selected.externalParkId
      );
      const parkSlug = slugifyName(parkEntity?.name || selected.parkName || selected.externalParkId);
      const sparkplugGroupId = env.sparkplugGroupId || parkSlug;
      mergeThemeParksEntityRegistryFromLiveMessages({
        sparkplugGroupId,
        parkExternalId: String(selected.externalParkId),
        destinationExternalId: parkEntity?.destinationId != null ? String(parkEntity.destinationId) : null,
        messages: msgs,
      });
      await this.sparkplugPublisherFactory().publishFromLiveCanonicalMessages({
        parkSlug,
        provider: selected.provider,
        messages: msgs,
      });
    } catch (e) {
      logger.warn({ err: e.message }, 'canonicalToSparkplugPublisher after live sync failed');
    }

    if (typeof this.socketEvents.emitExternalParkDataUpdated === 'function') {
      this.socketEvents.emitExternalParkDataUpdated({
        provider: selected.provider,
        park: selected.externalParkId,
        sampledAt: new Date().toISOString(),
        messageCount: rows.length,
      });
    }

    /* Phase C3.7 — replaces the pre-C3.7 hard-coded provider-equals
     * 'themeparks_wiki' branch. */
    let platformLive = null;
    try {
      platformLive = await this.hookRegistry.runAfterLive(selected.provider, {
        externalParkId: selected.externalParkId,
        selected,
      });
    } catch (e) {
      logger.warn(
        { err: e.message },
        'platform live observations sync after integration live sync failed'
      );
      platformLive = { error: e.message };
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
    const adapter = await this.providerBrowser.resolveProvider(selected.provider);
    const cal = await adapter.fetchCalendar(selected.externalParkId, options);
    const msgs = adapter.normalizeToCanonicalMessages({
      type: 'calendar',
      parkId: selected.externalParkId,
      items: cal,
    });
    const autoApply = await this._autoApplyEnabled();
    const rows = await this.canonicalService.ingest(msgs, { autoApply });

    if (typeof adapter.fetchCrowdLevel === 'function') {
      try {
        const crowd = await adapter.fetchCrowdLevel(selected.externalParkId);
        const crowdMsgs = adapter.normalizeToCanonicalMessages({
          type: 'crowd',
          parkId: selected.externalParkId,
          items: crowd,
        });
        await this.canonicalService.ingest(crowdMsgs, { autoApply });
      } catch (e) {
        logger.warn({ err: e.message, provider: selected.provider }, 'crowd sync failed');
      }
    }
    return { count: rows.length, provider: selected.provider, externalParkId: selected.externalParkId };
  }

  async syncAllParksInDestination(provider, destinationId) {
    const parks = await this.providerBrowser.listAvailableParks(provider, destinationId);
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
}

module.exports = { CanonicalIngestionPipelineService };
