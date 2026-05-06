'use strict';

/**
 * Phase T.3 — single read-only governance model for “approved” operational signals
 * (Add-on Board, ML Studio, Operations Facts). Registry/capability rules align with
 * ride-signal-capability + prepared registry activation; consumer flags come from
 * ride master extensions (`boardEligible`, `mlEligible`, `operationsEligible`).
 */

const { AppError } = require('../utils/app-error');
const { SignalCatalog, UnsRegistryTopic, SparkplugMetricDefinition, REGISTRY_SOURCE_PREPARED_OPERATOR } = require('../models');
const { SUPPORTED_DOMAINS } = require('../modules/uns/topic-layout/topic-layout.constants');
const {
  resolveRideContext,
  loadMergedCapabilityMap,
  preparedUnsTopicsForRide,
  capabilitySignalSource,
  TOPIC_SOURCES,
} = require('./ride-signal-capability.service');
const signalPreview = require('./signal-preview.service');
const { getExtensions } = require('./ride-master-extensions.service');

const TOPIC_SOURCES_SET = new Set(TOPIC_SOURCES);

/**
 * @typedef {'board'|'ml'|'operations'} ApprovedSignalConsumer
 */

/**
 * Extension-side gates (same semantics signal-preview used for board/ml; adds operations).
 * @param {string} signalKey
 * @param {unknown} extensionsRecord
 * @param {ApprovedSignalConsumer} consumer
 */
function extensionConsumerApproved(signalKey, extensionsRecord, consumer) {
  const meta = signalPreview.computeSignalMetadata(signalKey, extensionsRecord);
  if (!meta.domainSupported) return { approved: false, reason: 'unsupported_domain' };
  if (!meta.hasEntry) return { approved: false, reason: 'missing_extension_signal' };
  if (!meta.eligibility.enabled) return { approved: false, reason: 'signal_disabled' };
  if (consumer === 'board' && !meta.eligibility.boardEligible) {
    return { approved: false, reason: 'not_board_eligible' };
  }
  if (consumer === 'ml' && !meta.eligibility.mlEligible) {
    return { approved: false, reason: 'not_ml_eligible' };
  }
  if (consumer === 'operations' && meta.eligibility.operationsEligible === false) {
    return { approved: false, reason: 'not_operations_eligible' };
  }
  return { approved: true, reason: 'extension_ok' };
}

/**
 * Registry + ride capability activation (read-only), shared with Operations Facts / MQTT governance.
 * @param {{
 *   cap: import('sequelize').Model | null | undefined,
 *   catalog: import('sequelize').Model | null | undefined,
 *   activeTopicRow: import('sequelize').Model | null | undefined,
 *   sparkRow: import('sequelize').Model | null | undefined,
 * }} p
 */
function evaluateRegistryGovernanceSync(p) {
  const { cap, catalog, activeTopicRow, sparkRow } = p;
  if (!catalog) return { ok: false, reason: 'no_catalog_row' };
  if (!cap) return { ok: false, reason: 'no_ride_capability' };
  const src = capabilitySignalSource(cap);
  if (src === 'NOT_AVAILABLE') return { ok: false, reason: 'capability_not_available' };
  const needsTopic = TOPIC_SOURCES_SET.has(src);
  if (!needsTopic) return { ok: true, reason: 'source_no_activation_topic' };
  const unsActive = Boolean(activeTopicRow && (activeTopicRow.get?.('isActive') ?? activeTopicRow.isActive));
  const sparkActive = Boolean(sparkRow && (sparkRow.get?.('isActive') ?? sparkRow.isActive));
  if (src === 'MQTT_EDGE') {
    if (unsActive || sparkActive) return { ok: true, reason: 'mqtt_edge_active_path' };
    return { ok: false, reason: 'mqtt_edge_no_active_registry_path' };
  }
  if (unsActive) return { ok: true, reason: 'uns_active_topic' };
  return { ok: false, reason: 'no_active_prepared_topic' };
}

/**
 * Operations Facts: when extension entries exist for this catalog `signalCode`, require at least one
 * enabled row with operationsEligible !== false. When none exist, legacy behaviour (capability-only).
 * @param {unknown} extensionsRecord
 * @param {string} signalCode
 */
function operationsExtensionAllowsForSignalCode(extensionsRecord, signalCode) {
  const keys = findExtensionKeysForSignalCode(extensionsRecord, signalCode);
  if (!keys.length) return true;
  const ext = getExtensions(extensionsRecord);
  return keys.some((k) => {
    const e = ext.signals[k];
    return Boolean(e?.enabled) && e?.operationsEligible !== false;
  });
}

/**
 * @param {unknown} extensionsRecord
 * @param {string} signalCode
 * @returns {string[]}
 */
function findExtensionKeysForSignalCode(extensionsRecord, signalCode) {
  const code = String(signalCode || '').trim();
  if (!code) return [];
  const ext = getExtensions(extensionsRecord);
  const { signals, domains } = ext;
  const out = [];
  const seen = new Set();
  const push = (k) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    if (signals[k]) out.push(k);
  };
  if (Array.isArray(domains)) {
    for (const dom of domains) {
      const d = String(dom || '').trim().toLowerCase();
      if (!d) continue;
      push(`${d}.${code}`);
    }
  }
  for (const dom of SUPPORTED_DOMAINS) {
    push(`${dom}.${code}`);
  }
  push(code);
  return out;
}

/**
 * @param {import('sequelize').Model} ctx.asset
 * @param {import('sequelize').Model} cap
 * @param {import('sequelize').Model} cat
 * @param {import('sequelize').Model | undefined} activeTopicRow
 * @param {import('sequelize').Model | undefined} sparkRow
 */
function evaluateApprovedForOperationsFactsRow({ asset, cap, cat, activeTopicRow, sparkRow }) {
  const signalCode = String(cat.get('signalCode') || '');
  if (!operationsExtensionAllowsForSignalCode(asset, signalCode)) {
    return { approved: false, reason: 'operations_extension_blocked' };
  }
  const gov = evaluateRegistryGovernanceSync({ cap, catalog: cat, activeTopicRow, sparkRow });
  if (!gov.ok) return { approved: false, reason: gov.reason };
  return { approved: true, reason: 'ok' };
}

/**
 * @param {Awaited<ReturnType<typeof resolveRideContext>>} ctx
 */
async function buildApprovalPrefetch(ctx) {
  const bySignal = await loadMergedCapabilityMap(ctx);
  const topicsAll = await UnsRegistryTopic.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, isActive: true },
    limit: 800,
  });
  const mine = preparedUnsTopicsForRide(ctx, topicsAll);
  /** @type {Map<string, import('sequelize').Model>} */
  const activeTopicByCatalogId = new Map();
  for (const t of mine) {
    const sid = (t.get('payloadJson') || {}).signalCatalogId;
    if (sid) activeTopicByCatalogId.set(String(sid), t);
  }
  const sparkRows = await SparkplugMetricDefinition.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, rideAssetId: ctx.assetId },
    limit: 300,
  });
  /** @type {Map<string, import('sequelize').Model>} */
  const sparkBySignalCode = new Map();
  for (const s of sparkRows) {
    const sk = s.get('signalKey') ?? s.get('metricName');
    if (sk != null && String(sk).trim()) sparkBySignalCode.set(String(sk).trim(), s);
  }
  return { bySignal, activeTopicByCatalogId, sparkBySignalCode };
}

/**
 * @param {string} signalKey
 */
async function findCatalogForSignalKey(signalKey) {
  const metric = signalPreview.metricFromSignalKey(String(signalKey));
  const sk = String(signalKey || '').trim();
  if (metric && metric !== '—') {
    const row = await SignalCatalog.findOne({
      where: { signalCode: metric },
      attributes: ['id', 'signalCode'],
    });
    if (row) return row;
  }
  if (sk && sk !== metric) {
    return SignalCatalog.findOne({
      where: { signalCode: sk },
      attributes: ['id', 'signalCode'],
    });
  }
  return null;
}

/**
 * @param {Awaited<ReturnType<typeof resolveRideContext>>} ctx
 * @param {unknown} asset
 * @param {string} signalKey
 * @param {ApprovedSignalConsumer} consumer
 * @param {Awaited<ReturnType<typeof buildApprovalPrefetch>>} prefetch
 */
async function evaluateApprovedWithPrefetch(ctx, asset, signalKey, consumer, prefetch) {
  const ext = extensionConsumerApproved(signalKey, asset, consumer);
  if (!ext.approved) {
    return { approved: false, reason: ext.reason, phase: 'extension' };
  }
  const cat = await findCatalogForSignalKey(signalKey);
  if (!cat) {
    return { approved: false, reason: 'unknown_catalog_signal', phase: 'catalog' };
  }
  const cap = prefetch.bySignal.get(String(cat.get('id')));
  const activeTopicRow = prefetch.activeTopicByCatalogId.get(String(cat.get('id')));
  const code = String(cat.get('signalCode') || '');
  const sparkRow = code ? prefetch.sparkBySignalCode.get(code) : undefined;
  const gov = evaluateRegistryGovernanceSync({ cap, catalog: cat, activeTopicRow, sparkRow });
  if (!gov.ok) {
    return { approved: false, reason: gov.reason, phase: 'governance' };
  }
  return { approved: true, reason: 'approved', phase: 'full' };
}

/**
 * @param {string} rideAssetId
 * @param {string} signalKey
 * @param {ApprovedSignalConsumer} consumer
 */
async function resolveApprovedOperationalSignal({ rideAssetId, signalKey, consumer }) {
  const ctx = await resolveRideContext(rideAssetId);
  const prefetch = await buildApprovalPrefetch(ctx);
  return evaluateApprovedWithPrefetch(ctx, ctx.asset, signalKey, consumer, prefetch);
}

/**
 * @param {string} rideAssetId
 * @param {string} signalKey
 */
async function assertBoardSignalApproved(rideAssetId, signalKey) {
  const r = await resolveApprovedOperationalSignal({ rideAssetId, signalKey, consumer: 'board' });
  if (r.approved) return { ok: true };
  return {
    ok: false,
    code: 'INVALID_SIGNAL',
    message: `Signal not approved for Add-on Board (${r.phase}: ${r.reason})`,
  };
}

/**
 * @param {unknown} record
 * @param {'ride'|'park_asset'} entityType
 */
function resolveRideAssetIdForGovernance(record, entityType) {
  if (!record) return null;
  const plain = typeof record.get === 'function' ? record.get({ plain: true }) : record;
  if (entityType === 'park_asset') {
    const id = plain.assetId ?? plain.asset_id;
    return id ? String(id) : null;
  }
  if (entityType === 'ride') {
    const id = plain.internalRideId ?? plain.internal_ride_id;
    return id ? String(id) : null;
  }
  return null;
}

/**
 * Legacy ML validation (extensions only) when no `internal_ride_id` → `park_assets.asset_id` link exists.
 * @param {unknown} rideOrAsset
 * @param {string[]} selectedSignalKeys
 */
function assertMlEligibleSelectionsExtensionsOnly(rideOrAsset, selectedSignalKeys) {
  if (!Array.isArray(selectedSignalKeys)) {
    throw new AppError('selectedSignalKeys must be an array', 400, { code: 'INVALID_ML_FEATURE_DRAFT' });
  }
  const invalid = [];
  for (const raw of selectedSignalKeys) {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) {
      invalid.push(String(raw));
      continue;
    }
    const ex = extensionConsumerApproved(key, rideOrAsset, 'ml');
    if (!ex.approved) invalid.push(key);
  }
  if (invalid.length) {
    throw new AppError('One or more signal keys are missing or not enabled+mlEligible on extensions', 400, {
      code: 'INVALID_ML_FEATURE_DRAFT',
      details: { invalidSignalKeys: invalid },
    });
  }
}

/**
 * @param {unknown} rideOrAsset
 * @param {string[]} selectedSignalKeys
 * @param {'ride'|'park_asset'} [entityType]
 */
async function assertMlEligibleSignalSelections(rideOrAsset, selectedSignalKeys, entityType = 'park_asset') {
  const rideAssetId = resolveRideAssetIdForGovernance(rideOrAsset, entityType);
  if (!rideAssetId) {
    assertMlEligibleSelectionsExtensionsOnly(rideOrAsset, selectedSignalKeys);
    return;
  }
  if (!Array.isArray(selectedSignalKeys)) {
    throw new AppError('selectedSignalKeys must be an array', 400, { code: 'INVALID_ML_FEATURE_DRAFT' });
  }
  const ctx = await resolveRideContext(rideAssetId);
  const prefetch = await buildApprovalPrefetch(ctx);
  const invalid = [];
  for (const raw of selectedSignalKeys) {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) {
      invalid.push(String(raw));
      continue;
    }
    const r = await evaluateApprovedWithPrefetch(ctx, ctx.asset, key, 'ml', prefetch);
    if (!r.approved) invalid.push(key);
  }
  if (invalid.length) {
    throw new AppError(
      'One or more signals are not approved for ML (extensions + registry/capability governance)',
      400,
      {
        code: 'INVALID_ML_FEATURE_DRAFT',
        details: { invalidSignalKeys: invalid },
      }
    );
  }
}

module.exports = {
  extensionConsumerApproved,
  evaluateRegistryGovernanceSync,
  evaluateApprovedForOperationsFactsRow,
  operationsExtensionAllowsForSignalCode,
  findExtensionKeysForSignalCode,
  buildApprovalPrefetch,
  resolveApprovedOperationalSignal,
  assertBoardSignalApproved,
  assertMlEligibleSignalSelections,
  resolveRideAssetIdForGovernance,
};
