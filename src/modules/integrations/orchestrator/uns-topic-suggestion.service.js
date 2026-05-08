'use strict';

/**
 * Phase C3.6 — extracted from `IntegrationOrchestratorService`.
 *
 * The largest extraction in Phase C3 (~190 LOC of intricate join logic).
 * This service is read-only / projection-only: it stitches together
 *
 *   1. external-entity mappings           (ExternalEntityMappingService)
 *   2. recent canonical inbound messages  (CanonicalInboundMessageService)
 *   3. master-data UNS topic rows         (uns-master-data-generation)
 *   4. user-managed manual UNS nodes      (ManualUnsNodeService)
 *   5. uploaded sparkplug schema override (sparkplug-topic-schema.service)
 *
 * …into the topology shown in the UNS browser. Three call sites:
 *
 *   - `getSuggestions()`               — builds the per-domain tree shown
 *                                        in the admin dashboard.
 *   - `getFlatRows()`                  — flattened list for direct
 *                                        persistence into `uns_nodes`.
 *   - `materializeFromSuggestions()`   — calls `UnsService.materializeLeavesFromIntegration`.
 *
 * Plus one helper method `buildDynamicUnsTopicNodesFromIntegrations` that
 * is used internally AND by `SparkplugTopicSchemaService` (via an
 * injected callback in the orchestrator).
 *
 * The service has many collaborators; all are injected via constructor
 * so the unit tests can run without DB / network access.
 */

const env = require('../../../config/env');
const { AppSettingRepository } = require('../../../repositories/app-setting.repository');
const { slugifyName } = require('../../../utils/slugify.util');
const { logger } = require('../../../utils/logger');
const { buildCanonicalUnsTopic } = require('../../uns/uns-topic-generator.service');
const {
  enrichRowsWithSparkplug: defaultEnrichRowsWithSparkplug,
} = require('../../uns/sparkplug-topic-builder.service');
const {
  resolveThemeParksPublicationDomain,
} = require('../../uns/theme-parks-entity-domain.service');
const {
  unsSchemaMatchesPark,
  applyUploadedUnsSchemaEntries,
  UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY,
} = require('./sparkplug-topic-schema.service');

const DEFAULT_EDGE_NODE = 'park_gateway';
const DYNAMIC_METRIC_FALLBACKS = ['status', 'queue_time'];

class UnsTopicSuggestionService {
  /**
   * @param {{
   *   selectedParkResolver: () => Promise<{ provider: string, externalParkId: string, parkName?: string }>,
   *   providerEntityResolver: (provider: string, entityId: string) => Promise<{ name?: string } | null>,
   *   manualNodeService: { list: Function },
   *   mappingService: { listMappings: Function },
   *   canonicalService: { list: Function },
   *   settingRepository?: { getValue: Function },
   *   masterDataRowGenerator?: (args: object) => Promise<object[]>,
   *   unsServiceFactory?: () => { materializeLeavesFromIntegration: Function },
   *   enrichRowsWithSparkplug?: Function,
   * }} deps
   */
  constructor(deps = {}) {
    this.selectedParkResolver = deps.selectedParkResolver;
    this.providerEntityResolver = deps.providerEntityResolver;
    this.manualNodeService = deps.manualNodeService;
    this.mappingService = deps.mappingService;
    this.canonicalService = deps.canonicalService;
    this.settingRepository = deps.settingRepository || new AppSettingRepository();
    this.masterDataRowGenerator = deps.masterDataRowGenerator;
    this.unsServiceFactory = deps.unsServiceFactory;
    this.enrichRowsWithSparkplug = deps.enrichRowsWithSparkplug || defaultEnrichRowsWithSparkplug;
  }

  /**
   * Stitch mappings + canonical messages + (best-effort) master-data
   * rows into a deduplicated list of UNS-topic rows.
   *
   * @param {{ provider: string, externalParkId: string }} selected
   * @param {string} parkSlug
   */
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
      const met =
        m.externalEntityType != null && String(m.externalEntityType).trim() !== ''
          ? String(m.externalEntityType).trim().toUpperCase()
          : null;
      nodesByEntity.set(m.externalEntityId, {
        externalEntityId: m.externalEntityId,
        entityName: m.externalEntityName || m.externalEntityId,
        assetSlug: slugifyName(m.externalEntityName || m.externalEntityId),
        entityType: met,
        domain: resolveThemeParksPublicationDomain(null, met),
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
        const et =
          etRaw != null && String(etRaw).trim() !== '' ? String(etRaw).trim().toUpperCase() : null;
        const assetSlug = slugifyName(
          payload.slug || payload.externalEntityName || msg.externalEntityId
        );
        nodesByEntity.set(msg.externalEntityId, {
          externalEntityId: msg.externalEntityId,
          entityName: payload.externalEntityName || msg.externalEntityId,
          assetSlug,
          entityType: et,
          domain: resolveThemeParksPublicationDomain(null, et),
          metrics: new Set(),
          source: 'CANONICAL',
        });
      }
      nodesByEntity.get(msg.externalEntityId).metrics.add(metric);
    }

    const integrationNodes = [...nodesByEntity.values()].flatMap((n) => {
      const metrics = n.metrics.size ? [...n.metrics] : DYNAMIC_METRIC_FALLBACKS;
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
      // Master-data rows are best-effort; they require a working DB
      // and provider-specific master data, so any failure must NOT
      // block the suggestion preview.
      const generator = this.masterDataRowGenerator || this._lazyMasterDataRowGenerator();
      masterRows = await generator({
        provider: selected.provider,
        externalParkId: selected.externalParkId,
        parkSlug,
      });
    } catch (e) {
      logger.warn({ err: e.message }, 'UNS: master-data topic rows skipped');
    }

    const byPath = new Map();
    for (const r of integrationNodes) byPath.set(r.topicPath, r);
    for (const r of masterRows) byPath.set(r.topicPath, r);
    return [...byPath.values()];
  }

  /** Internal: stitch dynamic + manual + override into the suggestion core shape. */
  async _buildCore() {
    const selected = await this.selectedParkResolver();
    const parkEntity = await this.providerEntityResolver(selected.provider, selected.externalParkId);
    const parkSlug = slugifyName(parkEntity?.name || selected.parkName || selected.externalParkId);

    const [manualNodes, storedOverride] = await Promise.all([
      this.manualNodeService.list({
        provider: selected.provider,
        externalParkId: selected.externalParkId,
      }),
      this.settingRepository.getValue(UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY, null),
    ]);

    let dynamicNodes = await this.buildDynamicUnsTopicNodesFromIntegrations(selected, parkSlug);
    let schemaOverrideActive = false;
    const matchedOverride =
      storedOverride?.entries?.length && unsSchemaMatchesPark(storedOverride, selected)
        ? storedOverride
        : null;
    if (matchedOverride) {
      dynamicNodes = applyUploadedUnsSchemaEntries(matchedOverride.entries, selected, parkSlug);
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
  async getFlatRows() {
    const core = await this._buildCore();
    return { parkSlug: core.parkSlug, rows: [...core.dynamicNodes, ...core.manualRows] };
  }

  /** Persist the flat rows into `uns_nodes` via UnsService. */
  async materializeFromSuggestions() {
    const factory = this.unsServiceFactory || (() => this._lazyUnsService());
    const { parkSlug, rows } = await this.getFlatRows();
    const lean = rows.map((r) => ({
      topicPath: r.topicPath,
      domain: r.domain,
      assetSlug: r.assetSlug,
      metric: r.metric,
      entityName: r.entityName,
      entityType: r.entityType,
      source: r.source,
    }));
    const unsService = factory();
    return unsService.materializeLeavesFromIntegration(parkSlug, lean);
  }

  /** Tree projection used by the admin dashboard's UNS browser. */
  async getSuggestions() {
    const core = await this._buildCore();
    const {
      selected,
      parkSlug,
      dynamicNodes: dynRaw,
      manualRows,
      manualNodes,
      schemaOverrideActive,
      matchedOverride,
    } = core;

    const groupId = matchedOverride?.sparkplug?.groupId || env.sparkplugGroupId || parkSlug;
    const edgeNodeId =
      matchedOverride?.sparkplug?.edgeNodeId || env.sparkplugEdgeNode || DEFAULT_EDGE_NODE;
    const dynamicNodes = this.enrichRowsWithSparkplug(dynRaw, { groupId, edgeNodeId });
    const manual = this.enrichRowsWithSparkplug(manualRows, { groupId, edgeNodeId });

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

  /* -------------------- lazy collaborator helpers -------------------- *
   * The orchestrator passes injected collaborators in tests and prod;
   * these fallbacks exist purely so a zero-arg constructor still works
   * for casual instantiation in REPLs / scripts. They use require() at
   * call time to avoid a hard import-cycle through `UnsService`. */

  _lazyMasterDataRowGenerator() {
    const mod = require('../../uns/uns-master-data-generation.service');
    return mod.generateUnsTopicRowsFromMasterData;
  }

  _lazyUnsService() {
    const { UnsService } = require('../../uns/uns.service');
    return new UnsService();
  }
}

module.exports = { UnsTopicSuggestionService };
