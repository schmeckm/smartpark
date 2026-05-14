'use strict';

const seedMap = require('../seeds/europa-park-restaurant-zone-map.json');
const { normalizeName, normalizeSlug } = require('../utils/normalize-name.util');
const { resolveSparkplugEdgeFromParkProfile, buildSparkplugDdataPreview } = require('./sparkplug-edge-resolver.service');

const ZONE_QUALITY = Object.freeze({
  ASSIGNED: 'ASSIGNED',
  HEURISTIC_ASSIGNED: 'HEURISTIC_ASSIGNED',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  MISSING: 'MISSING',
  INVALID: 'INVALID',
});

const VALID_RESTAURANT_TYPE = 'RESTAURANT';
const DISALLOWED_ZONE_SLUGS = new Set(['general']);

const CANONICAL_EUROPA_PARK_ZONES = new Set([
  'germany',
  'france',
  'italy',
  'spain',
  'portugal',
  'greece',
  'switzerland',
  'austria',
  'netherlands',
  'england',
  'ireland',
  'iceland',
  'scandinavia',
  'russia',
  'croatia',
  'luxembourg',
  'liechtenstein',
  'minimoys',
  'grimm',
  'adventure_land',
  'monaco',
]);

const HEURISTICS = [
  { keywords: ['mykonos', 'greek', 'taverna'], zoneSlug: 'greece' },
  { keywords: ['venezia', 'italian', 'italiano', 'gelateria', 'pizza'], zoneSlug: 'italy' },
  { keywords: ['quichotte', 'bodega', 'tapas', 'spanish'], zoneSlug: 'spain' },
  { keywords: ['fjord', 'havn', 'smutje', 'lachs'], zoneSlug: 'scandinavia' },
  { keywords: ['kaffi', 'iceland'], zoneSlug: 'iceland' },
  { keywords: ['holland', 'dutch', 'baai'], zoneSlug: 'netherlands' },
  { keywords: ['alsatian', 'france', 'french', 'vin', 'petite'], zoneSlug: 'france' },
  { keywords: ['castle', 'balthasar', 'rock cafe', 'burger bar'], zoneSlug: 'germany' },
  { keywords: ['omackay', 'irish'], zoneSlug: 'ireland' },
  { keywords: ['atlantica', 'portugal'], zoneSlug: 'portugal' },
  { keywords: ['three piglets', 'grimm'], zoneSlug: 'grimm' },
  { keywords: ['adventure food', 'spices'], zoneSlug: 'adventure_land' },
];

const SEEDED_MATCHES = seedMap.map((row) => ({
  ...row,
  matchNorm: normalizeName(row.match),
  slugHintNorm: normalizeSlug(row.slugHint),
}));

/**
 * @param {{ parkId: string, assetName?: string | null, assetSlug?: string | null }} args
 */
async function resolveRestaurantZone({ parkId, assetName, assetSlug }) {
  const normName = normalizeName(assetName || '');
  const normSlug = normalizeSlug(assetSlug || '');
  const matchInput = `${normName} ${normSlug}`.trim();

  const exact =
    SEEDED_MATCHES.find((row) => row.matchNorm && row.matchNorm === normName) ||
    SEEDED_MATCHES.find((row) => row.slugHintNorm && row.slugHintNorm === normSlug);

  if (exact) {
    return {
      assetName: assetName || null,
      assetSlug: assetSlug || null,
      zoneSlug: exact.zoneSlug,
      matchType: exact.matchNorm === normName ? 'EXACT_NAME' : 'SLUG_HINT',
      confidence: exact.confidence,
      reason: `seed:${exact.slugHint}`,
    };
  }

  for (const rule of HEURISTICS) {
    if (rule.keywords.some((k) => matchInput.includes(k))) {
      return {
        assetName: assetName || null,
        assetSlug: assetSlug || null,
        zoneSlug: rule.zoneSlug,
        matchType: 'HEURISTIC',
        confidence: 'MEDIUM',
        reason: `keyword:${rule.keywords.join('|')}`,
      };
    }
  }

  return {
    assetName: assetName || null,
    assetSlug: assetSlug || null,
    zoneSlug: null,
    matchType: 'NONE',
    confidence: 'LOW',
    reason: 'no_match',
  };
}

/**
 * @param {string | null | undefined} zoneSlug
 */
function isValidZoneSlug(zoneSlug) {
  const normalized = normalizeSlug(zoneSlug || '');
  if (!normalized || DISALLOWED_ZONE_SLUGS.has(normalized)) return false;
  if (normalized.includes('default')) return false;
  return CANONICAL_EUROPA_PARK_ZONES.has(normalized);
}

function qualityFromResolution(resolved) {
  if (!resolved.zoneSlug) return ZONE_QUALITY.MISSING;
  if (!isValidZoneSlug(resolved.zoneSlug)) return ZONE_QUALITY.INVALID;
  if (resolved.matchType === 'HEURISTIC') return ZONE_QUALITY.HEURISTIC_ASSIGNED;
  if (String(resolved.confidence).toUpperCase() === 'LOW') return ZONE_QUALITY.LOW_CONFIDENCE;
  return ZONE_QUALITY.ASSIGNED;
}

/**
 * @param {{
 *  models: Record<string, any>,
 *  parkSlug: string,
 *  type?: string,
 * }} args
 */
async function previewRestaurantZoneNormalization({ models, parkSlug, type = VALID_RESTAURANT_TYPE }) {
  const { Park, ParkZone, ParkAsset, AssetType } = models;
  const park = await Park.findOne({
    where: { slug: normalizeSlug(parkSlug) },
    attributes: ['id', 'slug', 'masterProfile'],
  });
  if (!park) return { park: null, rows: [] };

  const assetType = await AssetType.findOne({
    where: { code: String(type || '').toUpperCase() },
    attributes: ['id', 'code'],
  });
  if (!assetType) return { park: park.get({ plain: true }), rows: [] };

  const zones = await ParkZone.findAll({
    where: { parkId: park.id },
    attributes: ['id', 'slug', 'name'],
  });
  const zonesBySlug = new Map(zones.map((z) => [normalizeSlug(z.slug), z]));
  const zonesById = new Map(zones.map((z) => [String(z.id), z]));

  const assets = await ParkAsset.findAll({
    where: { parkId: park.id, assetTypeId: assetType.id, activeFlag: true },
    attributes: ['assetId', 'name', 'slug', 'zoneId', 'enrichment'],
    order: [['name', 'ASC']],
  });

  const rows = [];
  for (const asset of assets) {
    const plain = asset.get({ plain: true });
    const resolved = await resolveRestaurantZone({
      parkId: park.id,
      assetName: plain.name,
      assetSlug: plain.slug,
    });
    const zoneQuality = qualityFromResolution(resolved);
    const currentZone = plain.zoneId ? zonesById.get(String(plain.zoneId)) || null : null;
    const proposedZone = resolved.zoneSlug ? zonesBySlug.get(normalizeSlug(resolved.zoneSlug)) || null : null;
    const edgeResolved = resolveSparkplugEdgeFromParkProfile({
      parkMasterProfile: park.masterProfile,
      zoneSlug: proposedZone?.slug || null,
    });
    const sparkplugTopicPreview = buildSparkplugDdataPreview({
      parkSlugForGroup: park.slug,
      edgeResolution: edgeResolved,
      assetSlug: plain.slug || plain.name || plain.assetId,
    });
    rows.push({
      assetId: plain.assetId,
      assetName: plain.name,
      assetSlug: plain.slug,
      currentZoneSlug: currentZone?.slug || null,
      currentZoneName: currentZone?.name || null,
      proposedZoneSlug: proposedZone?.slug || resolved.zoneSlug || null,
      proposedZoneName: proposedZone?.name || null,
      zoneSlugFoundInPark: Boolean(proposedZone),
      matchType: resolved.matchType,
      confidence: resolved.confidence,
      reason: resolved.reason,
      zoneQuality,
      edgeNodeId: edgeResolved.edgeNodeId,
      topicPreview: sparkplugTopicPreview,
    });
  }

  return { park: park.get({ plain: true }), rows };
}

/**
 * @param {{
 *  models: Record<string, any>,
 *  parkSlug: string,
 *  type?: string,
 *  dryRun?: boolean,
 *  overrides?: Array<{ assetId: string, zoneSlug: string | null }>,
 * }} args
 */
async function applyRestaurantZoneNormalization({ models, parkSlug, type, dryRun = true, overrides = [] }) {
  const { sequelize, ParkAsset, ParkZone } = models;
  const preview = await previewRestaurantZoneNormalization({ models, parkSlug, type });
  const park = preview.park;
  if (!park) return { dryRun, updated: 0, rows: [], park: null };

  const zoneBySlug = new Map(
    (
      await ParkZone.findAll({
        where: { parkId: park.id },
        attributes: ['id', 'slug', 'name'],
      })
    ).map((z) => [normalizeSlug(z.slug), z])
  );

  const overrideByAssetId = new Map((overrides || []).map((x) => [String(x.assetId), normalizeSlug(x.zoneSlug || '')]));
  const appliedRows = preview.rows.map((r) => {
    const overrideZoneSlug = overrideByAssetId.has(String(r.assetId)) ? overrideByAssetId.get(String(r.assetId)) || null : null;
    const selectedZoneSlug = overrideZoneSlug !== null ? overrideZoneSlug : r.proposedZoneSlug;
    const zoneRow = selectedZoneSlug ? zoneBySlug.get(normalizeSlug(selectedZoneSlug)) || null : null;
    let zoneQuality = r.zoneQuality;
    if (overrideZoneSlug !== null) {
      zoneQuality = zoneRow ? ZONE_QUALITY.ASSIGNED : ZONE_QUALITY.INVALID;
    } else if (selectedZoneSlug && !zoneRow) {
      zoneQuality = ZONE_QUALITY.INVALID;
    } else if (!selectedZoneSlug) {
      zoneQuality = ZONE_QUALITY.MISSING;
    }
    return {
      ...r,
      selectedZoneSlug,
      selectedZoneId: zoneRow ? String(zoneRow.id) : null,
      selectedZoneName: zoneRow ? String(zoneRow.name || '') : null,
      zoneQuality,
      overrideApplied: overrideZoneSlug !== null,
    };
  });

  if (dryRun) return { dryRun: true, updated: 0, rows: appliedRows, park };

  const tx = await sequelize.transaction();
  try {
    let updated = 0;
    for (const row of appliedRows) {
      const enrichmentPatch = {
        zoneNormalization: {
          zoneQuality: row.zoneQuality,
          matchType: row.matchType,
          confidence: row.confidence,
          reason: row.reason,
          proposedZoneSlug: row.selectedZoneSlug,
          updatedAt: new Date().toISOString(),
        },
      };
      await ParkAsset.update(
        {
          zoneId: row.selectedZoneId,
          enrichment: sequelize.literal(
            `COALESCE(enrichment, '{}'::jsonb) || '${JSON.stringify(enrichmentPatch).replace(/'/g, "''")}'::jsonb`
          ),
        },
        { where: { assetId: row.assetId }, transaction: tx }
      );
      updated += 1;
    }
    await tx.commit();
    return { dryRun: false, updated, rows: appliedRows, park };
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

module.exports = {
  ZONE_QUALITY,
  VALID_RESTAURANT_TYPE,
  resolveRestaurantZone,
  qualityFromResolution,
  previewRestaurantZoneNormalization,
  applyRestaurantZoneNormalization,
  isValidZoneSlug,
};
