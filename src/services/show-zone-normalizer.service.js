'use strict';

const seedMap = require('../seeds/europa-park-show-zone-map.json');
const { normalizeName, normalizeSlug } = require('../utils/normalize-name.util');
const { resolveSparkplugEdgeFromParkProfile, buildSparkplugDdataPreview } = require('./sparkplug-edge-resolver.service');

const ZONE_QUALITY = Object.freeze({
  ASSIGNED: 'ASSIGNED',
  VENUE_ASSIGNED: 'VENUE_ASSIGNED',
  HEURISTIC_ASSIGNED: 'HEURISTIC_ASSIGNED',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  MISSING: 'MISSING',
  INVALID: 'INVALID',
});

const VALID_SHOW_TYPE = 'SHOW';
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
  { keywords: ['venice', 'venezia', 'italiana', 'italiano', 'colosseo', 'scala', 'arte', 'colossal', 'piazza roma'], zoneSlug: 'italy', confidence: 'MEDIUM' },
  { keywords: ['globe', 'theatre', 'theater', 'shakespeare', 'wonderlab'], zoneSlug: 'england', confidence: 'HIGH' },
  { keywords: ['flamenca', 'carmen', 'energia', 'spanish'], zoneSlug: 'spain', confidence: 'MEDIUM' },
  { keywords: ['hellfire', 'lake europe'], zoneSlug: 'austria', confidence: 'HIGH' },
  { keywords: ['magic cinema', '4d'], zoneSlug: 'france', confidence: 'MEDIUM' },
  { keywords: ['dino'], zoneSlug: 'luxembourg', confidence: 'LOW' },
  { keywords: ['grimm', 'puppet', 'fairy', 'wonderland'], zoneSlug: 'grimm', confidence: 'LOW' },
  { keywords: ['parade'], zoneSlug: 'germany', confidence: 'LOW' },
];

const SEEDED_MATCHES = seedMap.map((row) => ({
  ...row,
  matchNorm: normalizeName(row.match),
  slugHintNorm: normalizeSlug(row.slugHint),
  venueHintNorm: normalizeName(row.venueHint || ''),
}));

function venueLike(a, b) {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function runHeuristics(normText, origin) {
  if (!normText) return null;
  for (const rule of HEURISTICS) {
    if (rule.keywords.some((k) => normText.includes(k))) {
      return {
        zoneSlug: rule.zoneSlug,
        matchType: 'HEURISTIC_KEYWORD',
        confidence: rule.confidence,
        reason: `${origin}:keyword:${rule.keywords.join('|')}`,
      };
    }
  }
  return null;
}

async function resolveShowZone({ parkId, assetName, assetSlug, venueName = null, externalPayload = null }) {
  const normName = normalizeName(assetName || '');
  const normSlug = normalizeSlug(assetSlug || '');
  const normVenue = normalizeName(venueName || '');

  const seededVenue = SEEDED_MATCHES.find((row) => row.venueHintNorm && venueLike(row.venueHintNorm, normVenue));
  if (seededVenue) {
    return {
      assetName: assetName || null,
      assetSlug: assetSlug || null,
      venueName: venueName || null,
      zoneSlug: seededVenue.zoneSlug,
      matchType: 'VENUE_HINT',
      confidence: seededVenue.confidence,
      reason: `seed:venue:${seededVenue.venueHint}`,
    };
  }

  const exact =
    SEEDED_MATCHES.find((row) => row.matchNorm && row.matchNorm === normName) ||
    SEEDED_MATCHES.find((row) => row.slugHintNorm && row.slugHintNorm === normSlug);
  if (exact) {
    return {
      assetName: assetName || null,
      assetSlug: assetSlug || null,
      venueName: venueName || null,
      zoneSlug: exact.zoneSlug,
      matchType: exact.matchNorm === normName ? 'EXACT_NAME' : 'SLUG_HINT',
      confidence: exact.confidence,
      reason: `seed:${exact.slugHint}`,
    };
  }

  const venueHeuristic = runHeuristics(normVenue, 'venue');
  if (venueHeuristic) {
    return {
      assetName: assetName || null,
      assetSlug: assetSlug || null,
      venueName: venueName || null,
      zoneSlug: venueHeuristic.zoneSlug,
      matchType: venueHeuristic.matchType,
      confidence: venueHeuristic.confidence,
      reason: venueHeuristic.reason,
    };
  }

  const nameHeuristic = runHeuristics(`${normName} ${normSlug}`.trim(), 'name_slug');
  if (nameHeuristic) {
    return {
      assetName: assetName || null,
      assetSlug: assetSlug || null,
      venueName: venueName || null,
      zoneSlug: nameHeuristic.zoneSlug,
      matchType: nameHeuristic.matchType,
      confidence: nameHeuristic.confidence,
      reason: nameHeuristic.reason,
    };
  }

  return {
    assetName: assetName || null,
    assetSlug: assetSlug || null,
    venueName: venueName || null,
    zoneSlug: null,
    matchType: 'NONE',
    confidence: 'LOW',
    reason: externalPayload ? 'no_match_with_payload' : 'no_match',
  };
}

function isValidZoneSlug(zoneSlug) {
  const normalized = normalizeSlug(zoneSlug || '');
  if (!normalized || DISALLOWED_ZONE_SLUGS.has(normalized)) return false;
  if (normalized.includes('default')) return false;
  return CANONICAL_EUROPA_PARK_ZONES.has(normalized);
}

function qualityFromResolution(resolved) {
  if (!resolved.zoneSlug) return ZONE_QUALITY.MISSING;
  if (!isValidZoneSlug(resolved.zoneSlug)) return ZONE_QUALITY.INVALID;
  if (String(resolved.confidence || '').toUpperCase() === 'LOW') return ZONE_QUALITY.LOW_CONFIDENCE;
  if (resolved.matchType === 'VENUE_HINT') return ZONE_QUALITY.VENUE_ASSIGNED;
  if (String(resolved.matchType || '').startsWith('HEURISTIC')) return ZONE_QUALITY.HEURISTIC_ASSIGNED;
  return ZONE_QUALITY.ASSIGNED;
}

async function previewShowZoneNormalization({ models, parkSlug, type = VALID_SHOW_TYPE }) {
  const { Park, ParkZone, ParkAsset, AssetType, ShowMasterData } = models;
  const park = await Park.findOne({
    where: { slug: normalizeSlug(parkSlug) },
    attributes: ['id', 'slug', 'name', 'masterProfile'],
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
    include: [{ model: ShowMasterData, as: 'showMaster', required: false, attributes: ['venueName'] }],
    order: [['name', 'ASC']],
  });

  const rows = [];
  for (const asset of assets) {
    const plain = asset.get({ plain: true });
    const venueName = plain?.showMaster?.venueName || null;
    const resolved = await resolveShowZone({
      parkId: park.id,
      assetName: plain.name,
      assetSlug: plain.slug,
      venueName,
      externalPayload: plain.enrichment || null,
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
      venueName,
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

async function applyShowZoneNormalization({ models, parkSlug, type, dryRun = true, overrides = [] }) {
  const { sequelize, ParkAsset, ParkZone } = models;
  const preview = await previewShowZoneNormalization({ models, parkSlug, type });
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
    const selectedZoneSlug = overrideZoneSlug === null ? r.proposedZoneSlug : overrideZoneSlug;
    const zoneRow = selectedZoneSlug ? zoneBySlug.get(normalizeSlug(selectedZoneSlug)) || null : null;
    let zoneQuality = r.zoneQuality;
    if (overrideZoneSlug !== null) {
      zoneQuality = zoneRow ? ZONE_QUALITY.ASSIGNED : ZONE_QUALITY.INVALID;
    } else if (selectedZoneSlug && zoneRow == null) {
      zoneQuality = ZONE_QUALITY.INVALID;
    } else if (selectedZoneSlug == null || selectedZoneSlug === '') {
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
          venueName: row.venueName || null,
          proposedZoneSlug: row.selectedZoneSlug,
          updatedAt: new Date().toISOString(),
        },
      };
      await ParkAsset.update(
        {
          zoneId: row.selectedZoneId,
          enrichment: sequelize.literal(
            `COALESCE(enrichment, '{}'::jsonb) || '${JSON.stringify(enrichmentPatch).replaceAll("'", "''")}'::jsonb`
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
  VALID_SHOW_TYPE,
  resolveShowZone,
  qualityFromResolution,
  previewShowZoneNormalization,
  applyShowZoneNormalization,
  isValidZoneSlug,
};
