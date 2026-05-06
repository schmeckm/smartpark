'use strict';

const { AppError } = require('../utils/app-error');
const { MdmRide, ParkAsset } = require('../models');
const { AppSettingRepository } = require('../repositories/app-setting.repository');
const { assertMlEligibleSelections } = require('./signal-preview.service');

const APP_KEY = 'aiStudio.featureDrafts';

/**
 * @param {'ride'|'park_asset'} entityType
 * @param {string} entityId
 * @param {string} datasetScope
 */
function compositeKey(entityType, entityId, datasetScope) {
  return `${entityType}:${String(entityId).trim()}:${String(datasetScope).trim()}`;
}

/**
 * @param {unknown} bundle
 * @returns {{ v: number, parks: Record<string, Record<string, Record<string, unknown>>> }}
 */
function normalizeBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return { v: 1, parks: {} };
  const b = /** @type {Record<string, unknown>} */ (bundle);
  const parks = b.parks && typeof b.parks === 'object' && !Array.isArray(b.parks) ? b.parks : {};
  return { v: 1, parks: /** @type {Record<string, Record<string, unknown>>} */ (parks) };
}

/**
 * @param {string} parkId
 * @param {'ride'|'park_asset'} entityType
 * @param {string} entityId
 */
async function loadEntityForPark(parkId, entityType, entityId) {
  const pid = String(parkId || '').trim();
  const eid = String(entityId || '').trim();
  if (!pid || !eid) throw new AppError('Park and entityId required', 400, { code: 'INVALID_ML_FEATURE_DRAFT' });

  if (entityType === 'ride') {
    const ride = await MdmRide.findByPk(eid);
    if (!ride) throw new AppError('Ride not found', 404, { code: 'NOT_FOUND' });
    if (String(ride.parkId) !== pid) throw new AppError('Ride not found', 404, { code: 'NOT_FOUND' });
    return ride;
  }
  if (entityType === 'park_asset') {
    const asset = await ParkAsset.findByPk(eid);
    if (!asset) throw new AppError('Asset not found', 404, { code: 'ASSET_NOT_FOUND' });
    if (String(asset.parkId) !== pid) throw new AppError('Asset not found', 404, { code: 'ASSET_NOT_FOUND' });
    return asset;
  }
  throw new AppError('Invalid entityType', 400, { code: 'INVALID_ML_FEATURE_DRAFT' });
}

class AiStudioFeatureDraftService {
  constructor() {
    this.settings = new AppSettingRepository();
  }

  async readBundle() {
    const raw = await this.settings.getValue(APP_KEY, null);
    return normalizeBundle(raw);
  }

  async writeBundle(bundle) {
    await this.settings.upsertValue(APP_KEY, bundle);
  }

  /**
   * @param {string} parkId
   * @param {'ride'|'park_asset'} entityType
   * @param {string} entityId
   * @param {string} datasetScope
   * @returns {Promise<null | { entityType: string, entityId: string, datasetScope: string, selectedSignalKeys: string[], updatedAt?: string }>}
   */
  async getDraft(parkId, entityType, entityId, datasetScope) {
    await loadEntityForPark(parkId, entityType, entityId);
    const bundle = await this.readBundle();
    const pid = String(parkId);
    const key = compositeKey(entityType, entityId, datasetScope);
    const row = bundle.parks[pid]?.[key];
    if (!row || typeof row !== 'object') return null;
    const selected = Array.isArray(row.selectedSignalKeys) ? row.selectedSignalKeys.map(String) : [];
    const rid = row.entityId != null && String(row.entityId).trim() !== '' ? String(row.entityId) : String(entityId);
    const dscope =
      row.datasetScope != null && String(row.datasetScope).trim() !== '' ? String(row.datasetScope) : String(datasetScope);
    const out = {
      entityType: row.entityType === 'park_asset' ? 'park_asset' : 'ride',
      entityId: rid,
      datasetScope: dscope,
      selectedSignalKeys: selected,
    };
    if (row.updatedAt != null && row.updatedAt !== '') {
      Object.assign(out, { updatedAt: String(row.updatedAt) });
    }
    return out;
  }

  /**
   * @param {string} parkId
   * @param {{ entityType: 'ride'|'park_asset', entityId: string, datasetScope: string, selectedSignalKeys: string[] }} body
   */
  async putDraft(parkId, body) {
    const { entityType, entityId, datasetScope } = body;
    const record = await loadEntityForPark(parkId, entityType, entityId);
    const keys = Array.isArray(body.selectedSignalKeys) ? body.selectedSignalKeys : [];
    await assertMlEligibleSelections(record, keys, entityType);

    const normalizedKeys = keys.map((k) => String(k).trim()).filter(Boolean);
    const unique = [...new Set(normalizedKeys)];

    const bundle = await this.readBundle();
    const pid = String(parkId);
    const key = compositeKey(entityType, entityId, datasetScope);
    if (!bundle.parks[pid] || typeof bundle.parks[pid] !== 'object') bundle.parks[pid] = {};

    const doc = {
      entityType,
      entityId: String(entityId).trim(),
      datasetScope: String(datasetScope).trim(),
      selectedSignalKeys: unique,
      updatedAt: new Date().toISOString(),
    };
    bundle.parks[pid][key] = doc;
    await this.writeBundle(bundle);
    return doc;
  }
}

module.exports = {
  AiStudioFeatureDraftService,
  compositeKey,
  normalizeBundle,
  assertMlEligibleSelections,
  APP_KEY,
};
