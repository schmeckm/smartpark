'use strict';

const { ParkAsset, Park } = require('../models');
const signalPreview = require('./signal-preview.service');
const approvedSignals = require('./approved-operational-signal.service');

const WIDGET_DRAFT_PROFILE_KEY = 'addonBoardWidgetSourceDraft';

/**
 * @param {unknown} v
 * @returns {v is { sourceType: string, entityType: string, entityId: string, signalKey: string }}
 */
function isWellFormedDraft(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = /** @type {Record<string, unknown>} */ (v);
  return (
    o.sourceType === 'SIGNAL_METADATA' &&
    o.entityType === 'park_asset' &&
    typeof o.entityId === 'string' &&
    o.entityId.length > 0 &&
    typeof o.signalKey === 'string' &&
    o.signalKey.length > 0
  );
}

function domainFromSignalKey(signalKey) {
  return signalPreview.domainFromSignalKey(signalKey);
}

function metricFromSignalKey(signalKey) {
  return signalPreview.metricFromSignalKey(signalKey);
}

/**
 * Read-only Phase H preview: compare saved draft to current extensions (no KPI / MQTT).
 * @param {unknown} assetRecord — `ParkAsset`-like plain or Sequelize row with `masterProfile`
 * @param {{ signalKey: string }} draft
 * @returns {{ valid: boolean, domain: string, metric: string, enabled: boolean, boardEligible: boolean }}
 */
function resolveDraftPreviewForAsset(assetRecord, draft) {
  return signalPreview.resolveDraftPreviewForAsset(assetRecord, draft);
}

/**
 * Phase T.3 — extensions + registry/capability governance (same resolver as ML / Operations Facts).
 * @param {import('sequelize').Model|null} asset
 * @param {string} signalKey
 * @returns {Promise<{ ok: true } | { ok: false, code: 'INVALID_SIGNAL', message?: string }>}
 */
async function assertSignalBoardEligible(asset, signalKey) {
  const id = asset?.assetId ?? asset?.get?.('assetId') ?? asset?.getDataValue?.('assetId');
  return approvedSignals.assertBoardSignalApproved(String(id), signalKey);
}

/**
 * @param {unknown} masterProfile
 * @returns {{ sourceType: 'SIGNAL_METADATA', entityType: 'park_asset', entityId: string, signalKey: string } | null}
 */
function readDraftFromMasterProfile(masterProfile) {
  const mp = masterProfile && typeof masterProfile === 'object' && !Array.isArray(masterProfile) ? masterProfile : {};
  const raw = /** @type {Record<string, unknown>} */ (mp)[WIDGET_DRAFT_PROFILE_KEY];
  if (!isWellFormedDraft(raw)) return null;
  return {
    sourceType: 'SIGNAL_METADATA',
    entityType: 'park_asset',
    entityId: String(raw.entityId),
    signalKey: String(raw.signalKey),
  };
}

/**
 * @param {import('sequelize').Model} asset
 * @param {string} parkId
 * @param {string} signalKey
 */
async function resolveSignalPreviewFull(asset, parkId, signalKey, options = {}) {
  return signalPreview.resolveSignalPreview({
    parkId,
    entityType: 'park_asset',
    entityId: String(asset.assetId),
    signalKey,
    usage: 'board',
    extensionsRecord: asset,
    options,
  });
}

/**
 * @param {string} parkId
 * @param {string} rideAssetId
 * @returns {Promise<{ draft: { sourceType: 'SIGNAL_METADATA', entityType: 'park_asset', entityId: string, signalKey: string }, resolved: ReturnType<typeof resolveDraftPreviewForAsset>, latestValue: { value: unknown, unit: string | null, ts: string, quality: string, source: string } | null, signalPreview?: object } | null>}
 */
async function getWidgetSourceDraftPreview(parkId, rideAssetId) {
  const asset = await ParkAsset.findOne({
    where: { parkId, assetId: rideAssetId },
    attributes: ['assetId', 'parkId', 'masterProfile', 'slug', 'externalEntityId'],
    include: [{ model: Park, as: 'park', attributes: ['slug', 'name', 'id'] }],
  });
  if (!asset) {
    const err = new Error('ASSET_NOT_FOUND');
    /** @type {any} */ (err).code = 'ASSET_NOT_FOUND';
    throw err;
  }
  const draft = readDraftFromMasterProfile(asset.getDataValue('masterProfile') || asset.masterProfile);
  if (!draft) return null;
  const full = await resolveSignalPreviewFull(asset, parkId, draft.signalKey, {
    parkAssetForLatestValue: asset,
  });
  return {
    draft,
    resolved: full.legacy.resolved,
    latestValue: full.latestValue,
    signalPreview: signalPreview.serializeSignalPreview(full),
  };
}

/**
 * Phase I / K: single shared path — extensions `resolved` + read-only `latestValue` (no MQTT in handler).
 * @param {import('sequelize').Model} asset — `ParkAsset` with `park` association (slug), `slug`, `externalEntityId`, `assetId`
 * @param {string} parkId
 * @param {string} signalKey
 * @returns {Promise<{ resolved: ReturnType<typeof resolveDraftPreviewForAsset>, latestValue: { value: unknown, unit: string | null, ts: string, quality: string, source: string } | null, signalPreview?: object }>}
 */
async function resolveSignalMetadataLatestPreview(asset, parkId, signalKey) {
  const full = await resolveSignalPreviewFull(asset, parkId, signalKey, {
    parkAssetForLatestValue: asset,
  });
  return {
    resolved: full.legacy.resolved,
    latestValue: full.latestValue,
    signalPreview: signalPreview.serializeSignalPreview(full),
  };
}

/**
 * @param {string} parkId
 * @param {string} rideAssetId
 * @param {{ sourceType: string, entityType: string, entityId: string, signalKey: string }} body
 * @returns {Promise<{ sourceType: 'SIGNAL_METADATA', entityType: 'park_asset', entityId: string, signalKey: string }>}
 */
async function saveWidgetSourceDraft(parkId, rideAssetId, body) {
  const asset = await ParkAsset.findOne({
    where: { parkId, assetId: rideAssetId },
    attributes: ['assetId', 'parkId', 'masterProfile'],
  });
  if (!asset) {
    const err = new Error('ASSET_NOT_FOUND');
    /** @type {any} */ (err).code = 'ASSET_NOT_FOUND';
    throw err;
  }
  const chk = await assertSignalBoardEligible(asset, body.signalKey);
  if (!chk.ok) {
    const err = new Error('INVALID_SIGNAL');
    /** @type {any} */ (err).code = 'INVALID_SIGNAL';
    throw err;
  }
  const draft = {
    sourceType: 'SIGNAL_METADATA',
    entityType: 'park_asset',
    entityId: String(rideAssetId),
    signalKey: String(body.signalKey).trim(),
  };
  const rawMp = asset.getDataValue('masterProfile') || asset.masterProfile;
  const mp = rawMp && typeof rawMp === 'object' && !Array.isArray(rawMp) ? { ...rawMp } : {};
  mp[WIDGET_DRAFT_PROFILE_KEY] = draft;
  await asset.update({ masterProfile: mp });
  return draft;
}

module.exports = {
  WIDGET_DRAFT_PROFILE_KEY,
  readDraftFromMasterProfile,
  getWidgetSourceDraftPreview,
  resolveDraftPreviewForAsset,
  resolveSignalMetadataLatestPreview,
  domainFromSignalKey,
  metricFromSignalKey,
  saveWidgetSourceDraft,
  assertSignalBoardEligible,
};
