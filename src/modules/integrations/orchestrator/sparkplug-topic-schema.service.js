'use strict';

/**
 * Phase C3.4 — extracted from `IntegrationOrchestratorService`.
 *
 * Owns the per-park "Sparkplug topic schema override" document
 * persisted in `app_settings[uns.sparkplugTopicSchema]`. The user can
 * upload a custom topic layout for a park; that layout overrides the
 * default mapping/canonical-message-derived topology used by
 * UnsTopicSuggestionService (extracted later in C3.6).
 *
 * Public surface (matches the orchestrator's pre-C3.4 methods):
 *   - `get({ source })`     — was `getSparkplugTopicSchemaDocument(...)`
 *   - `put(doc)`            — was `putSparkplugTopicSchemaDocument(...)`
 *   - `delete()`            — was `deleteSparkplugTopicSchemaDocument()`
 *
 * Plus two pure helpers exported as free functions because the
 * (still-on-orchestrator) UNS topic-suggestion code consumes them:
 *   - `unsSchemaMatchesPark(doc, selected)`
 *   - `applyUploadedUnsSchemaEntries(entries, selected, parkSlug)`
 *
 * The service is decoupled from the rest of the orchestrator via four
 * injected callbacks:
 *   - `selectedParkResolver`        — () => Promise<{ provider, externalParkId, parkName? }>
 *   - `parkSlugResolver`            — (selected) => Promise<string>
 *   - `dynamicTopicRowsResolver`    — (selected, parkSlug) => Promise<Row[]>
 *   - `enrichRowsWithSparkplug`     — defaults to the real implementation
 */

const { AppError } = require('../../../utils/app-error');
const { AppSettingRepository } = require('../../../repositories/app-setting.repository');
const { slugifyName } = require('../../../utils/slugify.util');
const env = require('../../../config/env');
const {
  resolveThemeParksPublicationDomain,
} = require('../../uns/theme-parks-entity-domain.service');
const { generateTopicPath } = require('../../uns/uns-topic-generator.service');
const {
  enrichRowsWithSparkplug: defaultEnrichRowsWithSparkplug,
} = require('../../uns/sparkplug-topic-builder.service');

const UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY = 'uns.sparkplugTopicSchema';
const SCHEMA_KIND = 'smartpark.uns.sparkplug_topics';
const SCHEMA_VERSION = 1;
const DEFAULT_EDGE_NODE = 'park_gateway';

/* -------------------------- pure helpers -------------------------- */

/**
 * Does the stored override document still belong to the currently
 * selected park? The user can switch parks while an override is on
 * disk; the document is then ignored until the same park is reselected.
 *
 * @param {{ provider?: string, externalParkId?: string } | null | undefined} doc
 * @param {{ provider: string, externalParkId: string }} selected
 * @returns {boolean}
 */
function unsSchemaMatchesPark(doc, selected) {
  return (
    String(doc?.provider) === String(selected.provider) &&
    String(doc?.externalParkId) === String(selected.externalParkId)
  );
}

/**
 * Normalize a list of uploaded schema entries to the same shape the
 * dynamic-topology builder produces. Slugifies asset/metric, fills in
 * domain via the theme-parks publication-domain helper, and computes a
 * default `topicPath` when none was provided.
 *
 * @param {Array<object>} entries
 * @param {{ provider: string, externalParkId: string }} selected
 * @param {string} parkSlug
 * @returns {Array<object>}
 */
function applyUploadedUnsSchemaEntries(entries, selected, parkSlug) {
  return entries.map((e) => {
    const assetSlug = slugifyName(e.assetSlug);
    const metric = slugifyName(e.metric);
    const customSp =
      e.sparkplugTopic && String(e.sparkplugTopic).trim() ? String(e.sparkplugTopic).trim() : undefined;
    const et =
      e.entityType != null && String(e.entityType).trim() !== ''
        ? String(e.entityType).trim().toUpperCase()
        : null;
    const resolvedDomain =
      e.domain != null && String(e.domain).trim() !== ''
        ? slugifyName(e.domain)
        : resolveThemeParksPublicationDomain(null, et);
    return {
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      externalEntityId:
        e.externalEntityId != null && e.externalEntityId !== ''
          ? String(e.externalEntityId)
          : null,
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

/* --------------------------- service ------------------------------ */

class SparkplugTopicSchemaService {
  /**
   * @param {{
   *   settingRepository?: { getValue: Function, upsertValue: Function, deleteByKey: Function },
   *   selectedParkResolver?: () => Promise<{ provider: string, externalParkId: string, parkName?: string }>,
   *   parkSlugResolver?: (selected: object) => Promise<string>,
   *   dynamicTopicRowsResolver?: (selected: object, parkSlug: string) => Promise<object[]>,
   *   enrichRowsWithSparkplug?: Function,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.settingRepository = deps.settingRepository || new AppSettingRepository();
    this.selectedParkResolver = deps.selectedParkResolver;
    this.parkSlugResolver = deps.parkSlugResolver;
    this.dynamicTopicRowsResolver = deps.dynamicTopicRowsResolver;
    this.enrichRowsWithSparkplug = deps.enrichRowsWithSparkplug || defaultEnrichRowsWithSparkplug;
  }

  /**
   * Build the document returned by GET /integrations/uns/sparkplug-schema.
   * `source: 'active'` returns the user-uploaded override (if it exists
   * and still matches the selected park). Anything else falls back to
   * the dynamic topology built from mappings + canonical messages +
   * master data.
   *
   * @param {{ source?: string }} args
   */
  async get({ source }) {
    if (typeof this.selectedParkResolver !== 'function') {
      throw new AppError('SparkplugTopicSchemaService missing selectedParkResolver', 500, {
        code: 'INTERNAL',
      });
    }
    const selected = await this.selectedParkResolver();
    const parkSlug = await this.parkSlugResolver(selected);
    const defaultGroupId = env.sparkplugGroupId || parkSlug;
    const defaultEdgeNodeId = env.sparkplugEdgeNode || DEFAULT_EDGE_NODE;

    if (source === 'active') {
      const stored = await this.settingRepository.getValue(UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY, null);
      if (stored?.entries?.length && unsSchemaMatchesPark(stored, selected)) {
        const groupId = stored.sparkplug?.groupId || defaultGroupId;
        const edgeNodeId = stored.sparkplug?.edgeNodeId || defaultEdgeNodeId;
        const entries = this.enrichRowsWithSparkplug([...stored.entries], { groupId, edgeNodeId });
        return {
          schemaVersion: SCHEMA_VERSION,
          kind: SCHEMA_KIND,
          provider: selected.provider,
          externalParkId: selected.externalParkId,
          parkSlug: stored.parkSlug || parkSlug,
          updatedAt: stored.updatedAt || null,
          sparkplug: { groupId, edgeNodeId },
          entries,
        };
      }
    }

    const dynamicNodes = await this.dynamicTopicRowsResolver(selected, parkSlug);
    const entries = this.enrichRowsWithSparkplug(dynamicNodes, {
      groupId: defaultGroupId,
      edgeNodeId: defaultEdgeNodeId,
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: SCHEMA_KIND,
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      parkSlug,
      updatedAt: null,
      sparkplug: { groupId: defaultGroupId, edgeNodeId: defaultEdgeNodeId },
      entries,
    };
  }

  /**
   * Validate + persist the user-uploaded override document.
   */
  async put(doc) {
    const selected = await this.selectedParkResolver();
    const parkSlug = await this.parkSlugResolver(selected);
    if (doc.externalParkId && String(doc.externalParkId) !== String(selected.externalParkId)) {
      throw new AppError('Schema externalParkId does not match selected park', 422, {
        code: 'VALIDATION_ERROR',
      });
    }
    if (doc.provider && String(doc.provider) !== String(selected.provider)) {
      throw new AppError('Schema provider does not match selected provider', 422, {
        code: 'VALIDATION_ERROR',
      });
    }
    const entriesRaw = applyUploadedUnsSchemaEntries(doc.entries, selected, parkSlug);
    const groupId = doc.sparkplug?.groupId || env.sparkplugGroupId || parkSlug;
    const edgeNodeId = doc.sparkplug?.edgeNodeId || env.sparkplugEdgeNode || DEFAULT_EDGE_NODE;
    const entries = this.enrichRowsWithSparkplug(entriesRaw, { groupId, edgeNodeId });
    const normalized = {
      schemaVersion: SCHEMA_VERSION,
      kind: SCHEMA_KIND,
      provider: selected.provider,
      externalParkId: selected.externalParkId,
      parkSlug: doc.parkSlug ? String(doc.parkSlug) : parkSlug,
      updatedAt: new Date().toISOString(),
      sparkplug: { groupId, edgeNodeId },
      entries,
    };
    await this.settingRepository.upsertValue(UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY, normalized);
    return { entryCount: normalized.entries.length };
  }

  async delete() {
    await this.settingRepository.deleteByKey(UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY);
  }
}

module.exports = {
  SparkplugTopicSchemaService,
  unsSchemaMatchesPark,
  applyUploadedUnsSchemaEntries,
  UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY,
};
