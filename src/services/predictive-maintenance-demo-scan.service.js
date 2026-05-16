'use strict';

const { Op } = require('sequelize');
const { Park, ParkAsset, RideMasterData, AssetType } = require('../models');
const { slugifyName } = require('../modules/uns/uns-topic-generator.service');

/**
 * @typedef {{ assetId: string; slug: string; name: string; entityType?: string }} PdmDemoAssetRow
 */

/**
 * `park_assets` has no `entity_type` column — class is `asset_types.code` via `asset_type_id`.
 * Scan config uses logical names (e.g. ATTRACTION) that map to seeded codes (e.g. RIDE).
 *
 * @param {string[]} scanEntityTypes uppercase codes from `normalizeScanEntityTypes`
 * @returns {string[]} distinct `asset_types.code` values
 */
function expandAssetTypeCodes(scanEntityTypes) {
  const aliases = {
    ATTRACTION: ['RIDE'],
    RIDE: ['RIDE'],
    SHOW: ['SHOW'],
    RESTAURANT: ['RESTAURANT'],
    SHOP: ['SHOP'],
    HOTEL: ['HOTEL'],
    FACILITY: ['FACILITY'],
    TOILET: ['TOILET'],
    ENTRANCE: ['ENTRANCE'],
    PARKING: ['PARKING'],
    SERVICE_POINT: ['SERVICE_POINT'],
    PARK: ['PARK'],
  };
  const out = new Set();
  for (const t of scanEntityTypes || []) {
    const k = String(t || '').trim().toUpperCase();
    if (!k) continue;
    const mapped = aliases[k];
    if (mapped) mapped.forEach((c) => out.add(c));
    else out.add(k);
  }
  const arr = [...out];
  return arr.length ? arr : ['RIDE'];
}

/**
 * @param {string} parkSlug
 * @returns {Promise<import('sequelize').Model|null>}
 */
async function findPlatformParkBySlug(parkSlug) {
  const raw = String(parkSlug || '').trim();
  if (!raw) return null;
  const norm = slugifyName(raw);
  return Park.findOne({
    where: { [Op.or]: [{ slug: raw }, { slug: norm }] },
    attributes: ['id', 'slug'],
  });
}

/**
 * @param {object} resolved output of `resolvePredictiveMaintenanceSimulatorConfig()`
 * @returns {Promise<PdmDemoAssetRow[]>}
 */
async function scanRideAssetsForPdMDemo(resolved) {
  const parkSlug = String(resolved.parkSlug || '').trim();
  if (!parkSlug) return [];

  const park = await findPlatformParkBySlug(parkSlug);
  if (!park) return [];

  const parkId = park.id;
  const types = Array.isArray(resolved.scanEntityTypes) ? resolved.scanEntityTypes : ['RIDE', 'ATTRACTION'];
  const assetTypeCodes = expandAssetTypeCodes(types);
  const max = Math.min(500, Math.max(1, Number(resolved.maxAssets) || 50));

  /** @type {ParkAsset[]} */
  const primary = await ParkAsset.findAll({
    where: {
      parkId,
      activeFlag: true,
    },
    include: [
      {
        model: AssetType,
        as: 'assetType',
        required: true,
        attributes: ['code'],
        where: { code: { [Op.in]: assetTypeCodes } },
      },
    ],
    attributes: ['assetId', 'slug', 'name'],
    order: [['slug', 'ASC']],
    limit: max,
  });

  /** @type {PdmDemoAssetRow[]} */
  let rows = primary.map((r) => {
    const p = r.get ? r.get({ plain: true }) : r;
    const code = p.assetType && p.assetType.code != null ? String(p.assetType.code) : undefined;
    return {
      assetId: String(p.assetId),
      slug: String(p.slug || '').trim() || 'asset',
      name: String(p.name || '').trim(),
      entityType: code,
    };
  });

  if (rows.length >= max) return rows.slice(0, max);

  /** Fallback: ride_master_data joined to park_assets (covers rides missing strict entity_type filter). */
  const remaining = max - rows.length;
  const seen = new Set(rows.map((r) => r.assetId));

  const rmdRows = await RideMasterData.findAll({
    include: [
      {
        model: ParkAsset,
        as: 'asset',
        required: true,
        where: { parkId, activeFlag: true },
        attributes: ['assetId', 'slug', 'name'],
        include: [
          {
            model: AssetType,
            as: 'assetType',
            required: false,
            attributes: ['code'],
          },
        ],
      },
    ],
    limit: remaining + rows.length,
  });

  for (const rm of rmdRows) {
    const plain = rm.get ? rm.get({ plain: true }) : rm;
    const a = plain.asset;
    if (!a) continue;
    const aid = String(a.assetId);
    if (seen.has(aid)) continue;
    seen.add(aid);
    const code = a.assetType && a.assetType.code != null ? String(a.assetType.code) : undefined;
    rows.push({
      assetId: aid,
      slug: String(a.slug || '').trim() || 'asset',
      name: String(a.name || '').trim(),
      entityType: code,
    });
    if (rows.length >= max) break;
  }

  rows.sort((x, y) => x.slug.localeCompare(y.slug));
  return rows.slice(0, max);
}

module.exports = {
  scanRideAssetsForPdMDemo,
  findPlatformParkBySlug,
  expandAssetTypeCodes,
};
