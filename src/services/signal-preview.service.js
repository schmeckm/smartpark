'use strict';

const { buildCanonicalUnsTopic } = require('../modules/uns/uns-topic-generator.service');
const { SUPPORTED_DOMAINS } = require('../modules/uns/topic-layout/topic-layout.constants');
const { getExtensions } = require('./ride-master-extensions.service');
const { readAddonBoardWidgetLatestValue } = require('./registry-preview.service');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/app-error');

/**
 * @typedef {'board'|'ml'|'green'|'generic'} SignalPreviewUsage
 */

/**
 * @typedef {'valid'|'disabled'|'missing_signal'|'not_board_eligible'|'not_ml_eligible'|'entity_mismatch'|'no_live_value'} SignalPreviewStatus
 */

function domainFromSignalKey(signalKey) {
  const i = String(signalKey).indexOf('.');
  if (i <= 0) return null;
  return String(signalKey).slice(0, i);
}

function metricFromSignalKey(signalKey) {
  const i = String(signalKey).indexOf('.');
  if (i <= 0) return '—';
  return String(signalKey).slice(i + 1) || '—';
}

/**
 * @param {unknown} entry
 * @returns {{ enabled: boolean, boardEligible: boolean, mlEligible: boolean }}
 */
function eligibilityFromEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { enabled: false, boardEligible: false, mlEligible: false };
  }
  const o = /** @type {Record<string, unknown>} */ (entry);
  return {
    enabled: Boolean(o.enabled),
    boardEligible: Boolean(o.boardEligible),
    mlEligible: Boolean(o.mlEligible),
  };
}

/**
 * @param {string} signalKey
 * @param {unknown} extensionsRecord — row `getExtensions` applies to
 */
function computeSignalMetadata(signalKey, extensionsRecord) {
  const key = String(signalKey || '').trim();
  const dom = domainFromSignalKey(key);
  const domainSupported = Boolean(dom && SUPPORTED_DOMAINS.includes(dom));
  const ext = getExtensions(extensionsRecord);
  const entry = ext.signals[key];
  const hasEntry = Boolean(entry && typeof entry === 'object');
  const eligibility = eligibilityFromEntry(hasEntry ? entry : null);
  return {
    key,
    domain: dom,
    metric: metricFromSignalKey(key),
    domainSupported,
    entry: hasEntry ? entry : null,
    hasEntry,
    eligibility,
  };
}

/**
 * @param {ReturnType<typeof computeSignalMetadata>} meta
 * @param {boolean} sourceEntityMismatch
 * @returns {{ valid: boolean, domain: string, metric: string, enabled: boolean, boardEligible: boolean }}
 */
function buildLegacyBoardResolved(meta, sourceEntityMismatch) {
  if (sourceEntityMismatch) {
    return {
      valid: false,
      domain: meta.domain || '—',
      metric: meta.metric,
      enabled: false,
      boardEligible: false,
    };
  }
  const valid = Boolean(
    meta.domainSupported && meta.hasEntry && meta.eligibility.enabled && meta.eligibility.boardEligible
  );
  return {
    valid,
    domain: meta.domain || '—',
    metric: meta.metric,
    enabled: meta.eligibility.enabled,
    boardEligible: meta.eligibility.boardEligible,
  };
}

/**
 * @param {{
 *   sourceEntityMismatch: boolean,
 *   domainSupported: boolean,
 *   hasEntry: boolean,
 *   eligibility: { enabled: boolean, boardEligible: boolean, mlEligible: boolean },
 *   usage: SignalPreviewUsage,
 *   latestValue: unknown | null,
 *   skipLatestValue: boolean,
 * }} p
 * @returns {SignalPreviewStatus}
 */
function deriveUnifiedStatus(p) {
  if (p.sourceEntityMismatch) return 'entity_mismatch';
  if (!p.domainSupported || !p.hasEntry) return 'missing_signal';
  if (!p.eligibility.enabled) return 'disabled';
  if (p.usage === 'board' && !p.eligibility.boardEligible) return 'not_board_eligible';
  if ((p.usage === 'ml' || p.usage === 'green') && !p.eligibility.mlEligible) return 'not_ml_eligible';
  if (p.skipLatestValue) return 'valid';
  if (p.latestValue == null) return 'no_live_value';
  return 'valid';
}

/**
 * @param {unknown} raw
 * @returns {{ value: unknown, unit: string | null, ts: string, quality: string, source: string } | null}
 */
function normalizeLatestValueRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  let tsIso;
  if (r.ts instanceof Date) tsIso = r.ts.toISOString();
  else if (r.ts) tsIso = String(r.ts);
  else tsIso = new Date(0).toISOString();
  return {
    value: r.value,
    unit: r.unit != null ? /** @type {string | null} */ (r.unit) : null,
    ts: tsIso,
    quality: String(r.quality || ''),
    source: String(r.source || ''),
  };
}

/**
 * @param {import('sequelize').Model} asset — ParkAsset with `park`, `slug`, `externalEntityId`, `assetId`
 * @param {string} parkId
 * @param {string} signalKey
 * @param {{ parkId: string, rideAssetId?: string }} logCtx
 * @returns {Promise<{ value: unknown, unit: string | null, ts: string, quality: string, source: string } | null>}
 */
async function fetchLatestValueForParkAsset(asset, parkId, signalKey, logCtx) {
  const key = String(signalKey).trim();
  try {
    const park = asset.park;
    const parkSlug = (park && (park.slug || park.name)) || String(parkId);
    const dom = domainFromSignalKey(key);
    const met = metricFromSignalKey(key);
    const topicPath = buildCanonicalUnsTopic({
      parkSlug,
      entityType: dom || 'unknown',
      entitySlug: String(asset.slug || ''),
      metric: met === '—' ? '' : met,
    });
    const raw = await readAddonBoardWidgetLatestValue({
      topicPath,
      externalEntityId: asset.externalEntityId || null,
      internalAssetId: String(asset.assetId),
      signalKey: key,
    });
    return normalizeLatestValueRow(raw);
  } catch (err) {
    logger.warn(
      { err, parkId, rideAssetId: logCtx.rideAssetId ?? asset.assetId },
      'signal-preview latestValue lookup failed'
    );
    return null;
  }
}

function boardLookupAllowed(meta, sourceEntityMismatch) {
  return (
    !sourceEntityMismatch &&
    meta.domainSupported &&
    meta.hasEntry &&
    meta.eligibility.enabled &&
    meta.eligibility.boardEligible
  );
}

function mlLookupAllowed(meta, sourceEntityMismatch) {
  return (
    !sourceEntityMismatch &&
    meta.domainSupported &&
    meta.hasEntry &&
    meta.eligibility.enabled &&
    meta.eligibility.mlEligible
  );
}

function genericLookupAllowed(meta, sourceEntityMismatch) {
  return !sourceEntityMismatch && meta.domainSupported && meta.hasEntry && meta.eligibility.enabled;
}

/**
 * @param {SignalPreviewUsage} usage
 * @param {ReturnType<typeof computeSignalMetadata>} meta
 * @param {boolean} sourceEntityMismatch
 */
function shouldRunLatestLookup(usage, meta, sourceEntityMismatch) {
  if (usage === 'board') return boardLookupAllowed(meta, sourceEntityMismatch);
  if (usage === 'ml' || usage === 'green') return mlLookupAllowed(meta, sourceEntityMismatch);
  return genericLookupAllowed(meta, sourceEntityMismatch);
}

/**
 * @param {{
 *   signalKey: string,
 *   domain: string | null,
 *   metric: string,
 *   eligibility: { enabled: boolean, boardEligible: boolean, mlEligible: boolean },
 *   status: SignalPreviewStatus,
 *   latestValue: ReturnType<typeof normalizeLatestValueRow>,
 * }} p
 */
function buildNormalizedPreviewShape(p) {
  return {
    signalKey: p.signalKey,
    domain: p.domain || '—',
    metric: p.metric,
    eligibility: { ...p.eligibility },
    status: p.status,
    latestValue: p.latestValue,
  };
}

/**
 * Unified read-only signal preview (metadata + optional latest value).
 *
 * @param {{
 *   parkId: string,
 *   entityType: 'ride'|'park_asset'|string,
 *   entityId: string,
 *   signalKey: string,
 *   usage: SignalPreviewUsage,
 *   extensionsRecord: unknown,
 *   options?: {
 *     sourceEntityMismatch?: boolean,
 *     parkAssetForLatestValue?: import('sequelize').Model | null,
 *     skipLatestValue?: boolean,
 *   },
 * }} args
 */
async function resolveSignalPreview(args) {
  const {
    parkId,
    entityType,
    entityId,
    signalKey,
    usage,
    extensionsRecord,
    options = {},
  } = args;
  const sourceEntityMismatch = Boolean(options.sourceEntityMismatch);
  const skipLatestValue = Boolean(options.skipLatestValue);
  const meta = computeSignalMetadata(signalKey, extensionsRecord);

  let latestValue = null;
  const asset = options.parkAssetForLatestValue;
  if (!skipLatestValue && asset && shouldRunLatestLookup(usage, meta, sourceEntityMismatch)) {
    latestValue = await fetchLatestValueForParkAsset(
      asset,
      parkId,
      meta.key,
      { parkId, rideAssetId: String(entityId) }
    );
  }

  const status = deriveUnifiedStatus({
    sourceEntityMismatch,
    domainSupported: meta.domainSupported,
    hasEntry: meta.hasEntry,
    eligibility: meta.eligibility,
    usage,
    latestValue,
    skipLatestValue,
  });

  const normalized = buildNormalizedPreviewShape({
    signalKey: meta.key,
    domain: meta.domain,
    metric: meta.metric,
    eligibility: meta.eligibility,
    status,
    latestValue,
  });

  const legacyResolved = buildLegacyBoardResolved(meta, sourceEntityMismatch);

  return {
    ...normalized,
    entityType: String(entityType || ''),
    entityId: String(entityId || ''),
    legacy: { resolved: legacyResolved },
  };
}

/**
 * Sync board draft resolution (same contract as legacy `resolveDraftPreviewForAsset` return shape).
 * @param {unknown} assetRecord
 * @param {string} signalKey
 */
function buildBoardDraftResolved(assetRecord, signalKey) {
  const meta = computeSignalMetadata(signalKey, assetRecord);
  return buildLegacyBoardResolved(meta, false);
}

/**
 * @param {unknown} assetRecord
 * @param {{ signalKey: string }} draft
 */
function resolveDraftPreviewForAsset(assetRecord, draft) {
  return buildBoardDraftResolved(assetRecord, draft.signalKey);
}

/**
 * @param {unknown} asset
 * @param {string} signalKey
 * @returns {{ ok: true } | { ok: false, code: 'INVALID_SIGNAL' }}
 */
function assertSignalBoardEligible(asset, signalKey) {
  const meta = computeSignalMetadata(signalKey, asset);
  if (!meta.domainSupported) return { ok: false, code: 'INVALID_SIGNAL' };
  if (!meta.hasEntry || !meta.eligibility.enabled || !meta.eligibility.boardEligible) {
    return { ok: false, code: 'INVALID_SIGNAL' };
  }
  return { ok: true };
}

/**
 * ML Studio draft validation — unchanged semantics vs Phase O (enabled + mlEligible + key present).
 * @param {unknown} rideOrAsset
 * @param {string[]} selectedSignalKeys
 */
/**
 * @param {Awaited<ReturnType<typeof resolveSignalPreview>>} preview
 */
function serializeSignalPreview(preview) {
  if (!preview) return undefined;
  const out = { ...preview };
  delete out.legacy;
  return out;
}

function assertMlEligibleSelections(rideOrAsset, selectedSignalKeys) {
  if (!Array.isArray(selectedSignalKeys)) {
    throw new AppError('selectedSignalKeys must be an array', 400, { code: 'INVALID_ML_FEATURE_DRAFT' });
  }
  const ext = getExtensions(rideOrAsset);
  const signals = ext.signals && typeof ext.signals === 'object' ? ext.signals : {};
  const invalid = [];
  for (const raw of selectedSignalKeys) {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) {
      invalid.push(String(raw));
      continue;
    }
    const entry = signals[key];
    if (!entry || typeof entry !== 'object') {
      invalid.push(key);
      continue;
    }
    if (!entry.enabled || !entry.mlEligible) invalid.push(key);
  }
  if (invalid.length) {
    throw new AppError('One or more signal keys are missing or not enabled+mlEligible on extensions', 400, {
      code: 'INVALID_ML_FEATURE_DRAFT',
      details: { invalidSignalKeys: invalid },
    });
  }
}

module.exports = {
  domainFromSignalKey,
  metricFromSignalKey,
  eligibilityFromEntry,
  computeSignalMetadata,
  deriveUnifiedStatus,
  buildLegacyBoardResolved,
  resolveSignalPreview,
  buildBoardDraftResolved,
  resolveDraftPreviewForAsset,
  assertSignalBoardEligible,
  assertMlEligibleSelections,
  normalizeLatestValueRow,
  serializeSignalPreview,
};
