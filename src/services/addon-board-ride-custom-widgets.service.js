'use strict';

const { ParkAsset, Park } = require('../models');
const {
  readDraftFromMasterProfile,
  resolveDraftPreviewForAsset,
} = require('./addon-board-widget-source.service');
const signalPreview = require('./signal-preview.service');

const CUSTOM_WIDGETS_PROFILE_KEY = 'addonBoardCustomWidgets';
const MAX_CUSTOM_WIDGETS = 24;

/**
 * @param {string} signalKey
 */
function widgetIdFromSignalKey(signalKey) {
  const tok = String(signalKey || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `signal_${tok || 'unknown'}`;
}

/**
 * @param {{ sourceType: string, entityType: string, entityId: string, signalKey: string }} draft
 */
function buildNormalizedWidgetFromDraft(draft) {
  const signalKey = String(draft.signalKey).trim();
  return {
    widgetId: widgetIdFromSignalKey(signalKey),
    title: signalKey,
    source: {
      sourceType: 'SIGNAL_METADATA',
      entityType: 'park_asset',
      entityId: String(draft.entityId),
      signalKey,
    },
    display: {
      type: 'latest_value',
      unitMode: 'fromSource',
      refreshMode: 'manual_or_existing_board_refresh',
    },
    enabled: true,
  };
}

/**
 * @param {unknown} w
 * @returns {w is Record<string, unknown>}
 */
function isPlainObject(w) {
  return Boolean(w && typeof w === 'object' && !Array.isArray(w));
}

/**
 * @param {unknown} row
 * @returns {ReturnType<typeof buildNormalizedWidgetFromDraft> | null}
 */
function normalizeStoredWidget(row) {
  if (!isPlainObject(row)) return null;
  const widgetId = typeof row.widgetId === 'string' ? row.widgetId.trim() : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  const src = row.source;
  if (!widgetId || !title || !isPlainObject(src)) return null;
  const st = String(src.sourceType || '');
  const et = String(src.entityType || '');
  const eid = typeof src.entityId === 'string' ? src.entityId.trim() : '';
  const sk = typeof src.signalKey === 'string' ? src.signalKey.trim() : '';
  if (st !== 'SIGNAL_METADATA' || et !== 'park_asset' || !eid || !sk) return null;
  const disp = isPlainObject(row.display) ? row.display : {};
  const type = String(disp.type || 'latest_value');
  const unitMode = String(disp.unitMode || 'fromSource');
  const refreshMode = String(disp.refreshMode || 'manual_or_existing_board_refresh');
  const enabled = row.enabled !== false;
  return {
    widgetId,
    title,
    source: { sourceType: 'SIGNAL_METADATA', entityType: 'park_asset', entityId: eid, signalKey: sk },
    display: { type, unitMode, refreshMode },
    enabled,
  };
}

/**
 * @param {unknown} masterProfile
 * @returns {ReturnType<typeof buildNormalizedWidgetFromDraft>[]}
 */
function readCustomWidgetsFromMasterProfile(masterProfile) {
  const mp = masterProfile && typeof masterProfile === 'object' && !Array.isArray(masterProfile) ? masterProfile : {};
  const raw = /** @type {Record<string, unknown>} */ (mp)[CUSTOM_WIDGETS_PROFILE_KEY];
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    const n = normalizeStoredWidget(row);
    if (n) out.push(n);
  }
  return out.slice(0, MAX_CUSTOM_WIDGETS);
}

/**
 * @param {unknown[]} rawList
 * @param {string} widgetId
 */
function findRawCustomWidgetIndex(rawList, widgetId) {
  const id = String(widgetId).trim();
  if (!Array.isArray(rawList)) return -1;
  for (let i = 0; i < rawList.length; i++) {
    const row = rawList[i];
    if (!isPlainObject(row)) continue;
    if (String(row.widgetId).trim() === id) return i;
  }
  return -1;
}

/**
 * Phase M — observability only; derived from Phase K fields (no extra storage or lookups).
 * @param {{ enabled: boolean, sourceEntityMismatch?: boolean, resolved?: { valid: boolean } | null, latestValue?: unknown | null }} row
 * @returns {'ok'|'invalid_source'|'disabled'|'no_live_value'|'entity_mismatch'}
 */
function deriveCustomWidgetHealth(row) {
  if (!row.enabled) return 'disabled';
  if (row.sourceEntityMismatch) return 'entity_mismatch';
  if (row.resolved && !row.resolved.valid) return 'invalid_source';
  if (row.resolved?.valid && row.latestValue == null) return 'no_live_value';
  return 'ok';
}

/** @param {Record<string, unknown>} row */
function attachCustomWidgetHealth(row) {
  return { ...row, health: deriveCustomWidgetHealth(row) };
}

/**
 * @param {import('sequelize').Model} asset
 * @param {string} parkId
 * @param {string} rideAssetId
 * @param {ReturnType<typeof buildNormalizedWidgetFromDraft>} w
 */
async function enrichRideCustomWidgetWithPreview(asset, parkId, rideAssetId, w) {
  if (!w.enabled) {
    return { ...w, resolved: null, latestValue: null };
  }
  if (w.source.sourceType !== 'SIGNAL_METADATA' || w.display.type !== 'latest_value') {
    return { ...w, resolved: null, latestValue: null };
  }
  const mismatch = String(w.source.entityId) !== String(rideAssetId);
  const full = await signalPreview.resolveSignalPreview({
    parkId,
    entityType: 'park_asset',
    entityId: String(rideAssetId),
    signalKey: w.source.signalKey,
    usage: 'board',
    extensionsRecord: asset,
    options: {
      sourceEntityMismatch: mismatch,
      parkAssetForLatestValue: mismatch ? null : asset,
      skipLatestValue: mismatch,
    },
  });
  const row = {
    ...w,
    resolved: full.legacy.resolved,
    latestValue: full.latestValue,
    signalPreview: signalPreview.serializeSignalPreview(full),
  };
  if (mismatch) return { ...row, sourceEntityMismatch: true };
  return row;
}

/**
 * @param {string} parkId
 * @param {string} rideAssetId
 * @returns {Promise<Awaited<ReturnType<typeof enrichRideCustomWidgetWithPreview>>[]>}
 */
async function getCustomWidgetsForRide(parkId, rideAssetId) {
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
  const list = readCustomWidgetsFromMasterProfile(asset.getDataValue('masterProfile') || asset.masterProfile);
  const enriched = await Promise.all(list.map((w) => enrichRideCustomWidgetWithPreview(asset, parkId, rideAssetId, w)));
  return enriched.map(attachCustomWidgetHealth);
}

/**
 * @param {string} parkId
 * @param {string} rideAssetId
 * @returns {Promise<ReturnType<typeof buildNormalizedWidgetFromDraft>>}
 */
async function promoteWidgetFromSourceDraft(parkId, rideAssetId) {
  const asset = await ParkAsset.findOne({
    where: { parkId, assetId: rideAssetId },
    attributes: ['assetId', 'parkId', 'masterProfile'],
  });
  if (!asset) {
    const err = new Error('ASSET_NOT_FOUND');
    /** @type {any} */ (err).code = 'ASSET_NOT_FOUND';
    throw err;
  }
  const mpRaw = asset.getDataValue('masterProfile') || asset.masterProfile;
  const draft = readDraftFromMasterProfile(mpRaw);
  if (!draft) {
    const err = new Error('DRAFT_MISSING');
    /** @type {any} */ (err).code = 'DRAFT_MISSING';
    throw err;
  }
  if (String(draft.entityId) !== String(rideAssetId)) {
    const err = new Error('DRAFT_ENTITY_MISMATCH');
    /** @type {any} */ (err).code = 'DRAFT_ENTITY_MISMATCH';
    throw err;
  }
  const resolved = resolveDraftPreviewForAsset(asset, draft);
  if (!resolved.valid) {
    const err = new Error('DRAFT_NOT_VALID');
    /** @type {any} */ (err).code = 'DRAFT_NOT_VALID';
    throw err;
  }

  const widget = buildNormalizedWidgetFromDraft(draft);
  const mp = mpRaw && typeof mpRaw === 'object' && !Array.isArray(mpRaw) ? { ...mpRaw } : {};
  const prev = readCustomWidgetsFromMasterProfile(mp);
  const without = prev.filter((w) => w.widgetId !== widget.widgetId);
  const next = [...without, widget].slice(-MAX_CUSTOM_WIDGETS);
  mp[CUSTOM_WIDGETS_PROFILE_KEY] = next;
  await asset.update({ masterProfile: mp });
  return widget;
}

/**
 * @param {string} parkId
 * @param {string} rideAssetId
 * @param {string} widgetId
 * @param {{ title?: string, enabled?: boolean }} patch
 * @returns {Promise<Awaited<ReturnType<typeof enrichRideCustomWidgetWithPreview>>>}
 */
async function patchCustomWidgetForRide(parkId, rideAssetId, widgetId, patch) {
  const wid = String(widgetId).trim();
  const asset = await ParkAsset.findOne({
    where: { parkId, assetId: rideAssetId },
    attributes: ['assetId', 'parkId', 'masterProfile'],
  });
  if (!asset) {
    const err = new Error('ASSET_NOT_FOUND');
    /** @type {any} */ (err).code = 'ASSET_NOT_FOUND';
    throw err;
  }
  const mpRaw = asset.getDataValue('masterProfile') || asset.masterProfile;
  const mp = mpRaw && typeof mpRaw === 'object' && !Array.isArray(mpRaw) ? { ...mpRaw } : {};
  const rawArr = Array.isArray(mp[CUSTOM_WIDGETS_PROFILE_KEY]) ? [...mp[CUSTOM_WIDGETS_PROFILE_KEY]] : [];
  const idx = findRawCustomWidgetIndex(rawArr, wid);
  if (idx < 0) {
    const err = new Error('CUSTOM_WIDGET_NOT_FOUND');
    /** @type {any} */ (err).code = 'CUSTOM_WIDGET_NOT_FOUND';
    throw err;
  }
  const nextRow = { ...rawArr[idx] };
  if (patch.title !== undefined) nextRow.title = patch.title;
  if (patch.enabled !== undefined) nextRow.enabled = patch.enabled;
  rawArr[idx] = nextRow;
  mp[CUSTOM_WIDGETS_PROFILE_KEY] = rawArr;
  await asset.update({ masterProfile: mp });
  await asset.reload({
    attributes: ['assetId', 'parkId', 'masterProfile', 'slug', 'externalEntityId'],
    include: [{ model: Park, as: 'park', attributes: ['slug', 'name', 'id'] }],
  });
  const list = readCustomWidgetsFromMasterProfile(asset.getDataValue('masterProfile') || asset.masterProfile);
  const w = list.find((x) => x.widgetId === wid);
  if (!w) {
    const err = new Error('CUSTOM_WIDGET_NOT_FOUND');
    /** @type {any} */ (err).code = 'CUSTOM_WIDGET_NOT_FOUND';
    throw err;
  }
  const enriched = await enrichRideCustomWidgetWithPreview(asset, parkId, rideAssetId, w);
  return attachCustomWidgetHealth(enriched);
}

/**
 * @param {string} parkId
 * @param {string} rideAssetId
 * @param {string} widgetId
 */
async function deleteCustomWidgetForRide(parkId, rideAssetId, widgetId) {
  const wid = String(widgetId).trim();
  const asset = await ParkAsset.findOne({
    where: { parkId, assetId: rideAssetId },
    attributes: ['assetId', 'parkId', 'masterProfile'],
  });
  if (!asset) {
    const err = new Error('ASSET_NOT_FOUND');
    /** @type {any} */ (err).code = 'ASSET_NOT_FOUND';
    throw err;
  }
  const mpRaw = asset.getDataValue('masterProfile') || asset.masterProfile;
  const mp = mpRaw && typeof mpRaw === 'object' && !Array.isArray(mpRaw) ? { ...mpRaw } : {};
  const rawArr = Array.isArray(mp[CUSTOM_WIDGETS_PROFILE_KEY]) ? [...mp[CUSTOM_WIDGETS_PROFILE_KEY]] : [];
  const idx = findRawCustomWidgetIndex(rawArr, wid);
  if (idx < 0) {
    const err = new Error('CUSTOM_WIDGET_NOT_FOUND');
    /** @type {any} */ (err).code = 'CUSTOM_WIDGET_NOT_FOUND';
    throw err;
  }
  rawArr.splice(idx, 1);
  mp[CUSTOM_WIDGETS_PROFILE_KEY] = rawArr;
  await asset.update({ masterProfile: mp });
}

module.exports = {
  CUSTOM_WIDGETS_PROFILE_KEY,
  widgetIdFromSignalKey,
  buildNormalizedWidgetFromDraft,
  readCustomWidgetsFromMasterProfile,
  deriveCustomWidgetHealth,
  getCustomWidgetsForRide,
  promoteWidgetFromSourceDraft,
  patchCustomWidgetForRide,
  deleteCustomWidgetForRide,
};
