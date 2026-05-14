/* eslint-disable no-console */
'use strict';

/**
 * Europa-Park — gezielte Korrektur von `park_assets.zone_id`, Ride-Typ (`ride_master_data.ride_category`),
 * `park_assets.master_profile.attractionClassification` und **`park_assets.enrichment.profileCompleteness`**
 * (wenn eine Entity-Vorlage mit `required_fields_json` gesetzt ist — gleiche Logik wie Master-Data-Service).
 *
 * ## MDM
 * `mdm_rides.park_zone_id` → **`mdm_park_zones.id`** (nicht `park_zones`). Optional synchron, siehe Kommentar unten.
 *
 * Shows/Restaurants: Korrektur-Liste ist auf **RIDE** ausgelegt; andere Typen werden nicht gescannt (`scanned` = Rides).
 *
 * Usage:
 *   npm run mdm:update-europapark-master-data -- --dry-run
 *   npm run mdm:update-europapark-master-data
 *   npm run mdm:update-europapark-master-data -- --only-zone
 *   npm run mdm:update-europapark-master-data -- --only-type
 *   npm run mdm:update-europapark-master-data -- --skip-profile-completeness
 */

require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { Op } = require('sequelize');
const { flattenTypedValues, profileCompleteness } = require(path.join(
  __dirname,
  '..',
  'src',
  'modules',
  'master-data',
  'master-data-profile.helper',
));
const {
  sequelize,
  Park,
  ParkZone,
  ParkAsset,
  AssetType,
  RideMasterData,
  ShowMasterData,
  RestaurantMasterData,
  EntityTypeTemplate,
  MdmPark,
  MdmParkZone,
  MdmRide,
} = require(path.join(__dirname, '..', 'src', 'models'));

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has('--dry-run');
const ONLY_ZONE = argv.has('--only-zone');
const ONLY_TYPE = argv.has('--only-type');
const SKIP_PROFILE_COMPLETENESS = argv.has('--skip-profile-completeness');

/**
 * Erwartete Zonen-Labels → mögliche `park_zones.slug`-Werte (Sync / frühere Skripte).
 */
const EXPECTED_ZONE_TO_SLUGS = {
  'Königreich der Minimoys': ['welt_der_kinder', 'koenigreich_der_minimoys'],
  Österreich: ['oesterreich'],
  Deutschland: ['deutschland'],
  Frankreich: ['frankreich'],
  Griechenland: ['griechenland'],
  Portugal: ['portugal'],
  Spanien: ['spanien'],
  Italien: ['italien'],
  Russland: ['russland'],
  Irland: ['irland'],
  England: ['england'],
  'Grimms Märchenwald': ['grimms_maerchenwald'],
  'Hotels / Resort': ['hotels_resort', 'hotels', 'resort'],
};

/** Nur diese Slugs dürfen bei Bedarf neu als `park_zones`-Zeile angelegt werden. */
const ZONES_AUTO_CREATE = new Set(['hotels_resort']);

/**
 * Fein-Typ (Prompt) → Wert für `ride_master_data.ride_category` (DB, max. 80 Zeichen).
 * Detaillierte Bezeichner (VR_RIDE, MAD_HOUSE, …) werden zusätzlich in `master_profile.attractionClassification` gehalten.
 */
const RIDE_CATEGORY_FOR_EXPECTED_TYPE = {
  DARK_RIDE: 'DARK_RIDE',
  ROLLER_COASTER: 'ROLLER_COASTER',
  WATER_RIDE: 'WATER_RIDE',
  TRANSPORT: 'TRANSPORT',
  PLAYGROUND: 'PLAYGROUND',
  TOWER_RIDE: 'TOWER_RIDE',
  BOAT_RIDE: 'BOAT_RIDE',
  CAR_RIDE: 'CAR_RIDE',
  FLAT_RIDE: 'FLAT_RIDE',
  VR_RIDE: 'DARK_RIDE',
  WATER_COASTER: 'WATER_RIDE',
  INTERACTIVE_DARK_RIDE: 'DARK_RIDE',
  MAD_HOUSE: 'DARK_RIDE',
  WALKTHROUGH: 'DARK_RIDE',
};

const EUROPA_PARK_MASTER_DATA_CORRECTIONS = [
  {
    names: ['ARTHUR', 'Arthur', 'Arthur - The Ride'],
    slugs: ['arthur'],
    expectedZone: 'Königreich der Minimoys',
    expectedType: 'DARK_RIDE',
    typeConfidence: 'HIGH',
    notes: 'Official location: Minimoys / Welt der Kinder.',
  },
  {
    names: ['Alpine Express Enzian', "Alpine Express 'Enzian'", 'Alpenexpress Enzian'],
    slugs: ['alpine_express_enzian', 'alpenexpress_enzian'],
    expectedZone: 'Österreich',
    expectedType: 'ROLLER_COASTER',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Alpenexpress Coastiality'],
    slugs: ['alpenexpress_coastiality'],
    expectedZone: 'Österreich',
    expectedType: 'VR_RIDE',
    typeConfidence: 'MEDIUM',
  },
  {
    names: ['Atlantica SuperSplash'],
    slugs: ['atlantica_supersplash'],
    expectedZone: 'Portugal',
    expectedType: 'WATER_COASTER',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Atlantis Adventure', 'Abenteuer Atlantis'],
    slugs: ['atlantis_adventure', 'abenteuer_atlantis'],
    expectedZone: 'Griechenland',
    expectedType: 'INTERACTIVE_DARK_RIDE',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Ba-a-a Express'],
    slugs: ['ba_a_a_express'],
    expectedZone: 'Irland',
    expectedType: 'ROLLER_COASTER',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Casa da Aventura'],
    slugs: ['casa_da_aventura'],
    expectedZone: 'Portugal',
    expectedType: 'PLAYGROUND',
    typeConfidence: 'MEDIUM',
  },
  {
    names: ["Cassandra's Curse", 'Fluch der Kassandra'],
    slugs: ['cassandra_s_curse', 'fluch_der_kassandra'],
    expectedZone: 'Griechenland',
    expectedType: 'MAD_HOUSE',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Castello dei Medici'],
    slugs: ['castello_dei_medici'],
    expectedZone: 'Italien',
    expectedType: 'DARK_RIDE',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Geisterschloss', 'Ghost Castle'],
    slugs: ['geisterschloss'],
    expectedZone: 'Italien',
    expectedType: 'DARK_RIDE',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Crazy Taxi'],
    slugs: ['crazy_taxi'],
    expectedZone: 'England',
    expectedType: 'FLAT_RIDE',
    typeConfidence: 'MEDIUM',
  },
  {
    names: ['Dancing Dingie'],
    slugs: ['dancing_dingie'],
    expectedZone: 'Irland',
    expectedType: 'BOAT_RIDE',
    typeConfidence: 'MEDIUM',
  },
  {
    names: ['Danube Steamer', 'Donau Dampfer'],
    slugs: ['danube_steamer', 'donau_dampfer'],
    expectedZone: 'Österreich',
    expectedType: 'BOAT_RIDE',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Dwarf City', 'Zwergenstadt'],
    slugs: ['dwarf_city', 'zwergenstadt'],
    expectedZone: 'Grimms Märchenwald',
    expectedType: 'WALKTHROUGH',
    typeConfidence: 'MEDIUM',
  },
  {
    names: ["EP Express station 'Greece'", 'EP Express Station Greece'],
    slugs: ['ep_express_station_greece'],
    expectedZone: 'Griechenland',
    expectedType: 'TRANSPORT',
    typeConfidence: 'HIGH',
  },
  {
    names: ["EP Express station 'Hotels'", 'EP Express Station Hotels'],
    slugs: ['ep_express_station_hotels'],
    expectedZone: 'Hotels / Resort',
    expectedType: 'TRANSPORT',
    typeConfidence: 'HIGH',
  },
  {
    names: ["EP Express station 'Spain'", 'EP Express Station Spain'],
    slugs: ['ep_express_station_spain'],
    expectedZone: 'Spanien',
    expectedType: 'TRANSPORT',
    typeConfidence: 'HIGH',
  },
  {
    names: ['EP-Express Station Alexanderplatz', 'EP Express Station Alexanderplatz'],
    slugs: ['ep_express_station_alexanderplatz'],
    expectedZone: 'Deutschland',
    expectedType: 'TRANSPORT',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Elf Ride', 'Elfenfahrt'],
    slugs: ['elf_ride', 'elfenfahrt'],
    expectedZone: 'Deutschland',
    expectedType: 'BOAT_RIDE',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Euro-Mir'],
    slugs: ['euro_mir'],
    expectedZone: 'Russland',
    expectedType: 'ROLLER_COASTER',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Euro-Tower'],
    slugs: ['euro_tower'],
    expectedZone: 'Frankreich',
    expectedType: 'TOWER_RIDE',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Eurosat - CanCan Coaster', 'Eurosat – CanCan Coaster'],
    slugs: ['eurosat_cancan_coaster'],
    expectedZone: 'Frankreich',
    expectedType: 'ROLLER_COASTER',
    typeConfidence: 'HIGH',
  },
  {
    names: ['Eurosat Coastiality'],
    slugs: ['eurosat_coastiality'],
    expectedZone: 'Frankreich',
    expectedType: 'VR_RIDE',
    typeConfidence: 'MEDIUM',
  },
];

const EUROPA_PARK_NEEDS_REVIEW = [
  {
    names: ['Adventure Playground'],
    slugs: ['adventure_playground'],
    reason: 'Generic name; zone cannot be safely inferred without official entity metadata.',
  },
  {
    names: ['Arena of Football - Be Part of It!'],
    slugs: ['arena_of_football_be_part_of_it'],
    reason: 'Likely England / Football area; verify official Europa-Park location before DB write.',
  },
  {
    names: ['Ball Pool'],
    slugs: ['ball_pool'],
    reason: 'Generic children attraction; verify official location before assigning zone.',
  },
];

function slugFromLabel(label) {
  let s = String(label || '').trim().toLowerCase();
  s = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  s = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (s || 'zone').slice(0, 128);
}

/** Normalisierung für Matching (Namen, Slugs als Wörter). */
function normalizeComparable(input) {
  if (input == null || input === '') return '';
  let s = String(input)
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, ' ')
    .replace(/[''`´]/g, "'");
  s = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  s = s.toLowerCase();
  s = s.replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return s;
}

function assetMatchesRule(asset, rule) {
  const aslug = String(asset.slug || '').toLowerCase();
  for (const s of rule.slugs || []) {
    if (aslug === String(s).toLowerCase()) return true;
  }
  const variants = new Set();
  for (const f of [asset.name, asset.shortName, asset.slug, asset.externalEntityId]) {
    const n = normalizeComparable(f);
    if (n) variants.add(n);
  }
  const slugSpaced = normalizeComparable(String(asset.slug || '').replace(/[-_]+/g, ' '));
  if (slugSpaced) variants.add(slugSpaced);
  for (const nm of rule.names || []) {
    const rn = normalizeComparable(nm);
    if (rn && variants.has(rn)) return true;
  }
  for (const s of rule.slugs || []) {
    const rn = normalizeComparable(String(s).replace(/[-_]+/g, ' '));
    if (rn && variants.has(rn)) return true;
  }
  return false;
}

function rulesMatchingAsset(asset) {
  return EUROPA_PARK_MASTER_DATA_CORRECTIONS.filter((rule) => assetMatchesRule(asset, rule));
}

function needsReviewHit(asset) {
  for (const nr of EUROPA_PARK_NEEDS_REVIEW) {
    if (assetMatchesRule(asset, { names: nr.names, slugs: nr.slugs })) return nr;
  }
  return null;
}

function rideCategoryValue(expectedType) {
  const v = RIDE_CATEGORY_FOR_EXPECTED_TYPE[expectedType];
  return v || 'DARK_RIDE';
}

function mergeAttractionClassification(masterProfile, expectedType, confidence) {
  const prev = masterProfile && typeof masterProfile === 'object' ? masterProfile : {};
  return {
    ...prev,
    attractionClassification: {
      source: 'manual_europapark_correction',
      primaryType: expectedType,
      confidence: confidence || 'HIGH',
      updatedAt: new Date().toISOString(),
    },
  };
}

async function findEuropaPark() {
  const variants = ['europa-park', 'europa_park', 'europapark'];
  let p = await Park.findOne({
    where: { slug: { [Op.in]: variants } },
  });
  if (p) return p;
  p = await Park.findOne({ where: { slug: { [Op.iLike]: 'europa%' } } });
  if (p) return p;
  p = await Park.findOne({ where: { name: { [Op.iLike]: 'Europa-Park' } } });
  return p;
}

function buildZoneSlugMap(zones) {
  const m = new Map();
  for (const z of zones) {
    m.set(String(z.slug || '').toLowerCase(), z);
  }
  return m;
}

function resolveZoneRow(zoneBySlug, expectedLabel) {
  const slugs = EXPECTED_ZONE_TO_SLUGS[expectedLabel] || [slugFromLabel(expectedLabel)];
  for (const sl of slugs) {
    const z = zoneBySlug.get(sl.toLowerCase());
    if (z) return { zone: z, slugUsed: z.slug };
  }
  return { zone: null, slugUsed: slugs[0] };
}

async function maxZoneSortOrder(parkId, transaction) {
  const row = await ParkZone.findOne({
    attributes: [[sequelize.fn('MAX', sequelize.col('sort_order')), 'm']],
    where: { parkId },
    raw: true,
    transaction,
  });
  return Number(row?.m) || 0;
}

async function loadMdmContext() {
  const mdmPark = await MdmPark.findOne({
    where: { code: { [Op.in]: ['europa_park', 'europa-park'] } },
  });
  if (!mdmPark) return { mdmPark: null, zonesByCode: new Map(), rides: [] };
  const mdmZones = await MdmParkZone.findAll({ where: { parkId: mdmPark.id } });
  const zonesByCode = new Map(mdmZones.map((z) => [String(z.code || '').toLowerCase(), z]));
  const rides = await MdmRide.findAll({ where: { parkId: mdmPark.id } });
  return { mdmPark, zonesByCode, rides };
}

function mdmCodesForPlatformZoneLabel(zoneLabel) {
  const m = {
    Holland: ['niederlande', 'holland'],
    'Königreich der Minimoys': ['welt_der_kinder', 'koenigreich_der_minimoys'],
    Monaco: ['monaco', 'frankreich'],
    Österreich: ['oesterreich'],
    'Hotels / Resort': ['hotels_resort', 'hotels', 'resort'],
  };
  if (m[zoneLabel]?.length) return m[zoneLabel];
  return [slugFromLabel(zoneLabel)];
}

function resolveMdmZone(zonesByCode, zoneLabel) {
  for (const code of mdmCodesForPlatformZoneLabel(zoneLabel)) {
    const z = zonesByCode.get(String(code).toLowerCase());
    if (z) return z;
  }
  return null;
}

function matchMdmRideToAsset(asset, mdmRides) {
  if (!mdmRides?.length) return null;
  if (asset.externalEntityId) {
    const byExt = mdmRides.filter((r) => r.externalId && String(r.externalId) === String(asset.externalEntityId));
    if (byExt.length === 1) return byExt[0];
    if (byExt.length > 1) return undefined;
  }
  const want = new Set(
    [normalizeComparable(asset.name), normalizeComparable(asset.shortName), slugSpacedNorm(asset.slug)].filter(
      Boolean,
    ),
  );
  const hits = mdmRides.filter((r) => want.has(normalizeComparable(r.name)));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return undefined;
  return null;
}

function slugSpacedNorm(slug) {
  return normalizeComparable(String(slug || '').replace(/[-_]+/g, ' '));
}

/**
 * Setzt `enrichment.profileCompleteness` wie der Master-Data-Service, sofern Vorlage + `required_fields_json`.
 * @returns {boolean} true bei tatsächlicher Aktualisierung
 */
async function syncProfileCompletenessForAsset(assetId, transaction) {
  const fresh = await ParkAsset.findByPk(assetId, {
    transaction,
    include: [
      { model: EntityTypeTemplate, as: 'entityTemplate', required: false },
      { model: RideMasterData, as: 'rideMaster', required: false },
      { model: ShowMasterData, as: 'showMaster', required: false },
      { model: RestaurantMasterData, as: 'restaurantMaster', required: false },
    ],
  });
  if (!fresh) return false;
  const tpl = fresh.entityTemplate;
  const req = Array.isArray(tpl?.requiredFieldsJson) ? tpl.requiredFieldsJson : [];
  if (!fresh.templateId || !req.length) return false;

  const rm =
    fresh.rideMaster && typeof fresh.rideMaster.toJSON === 'function' ? fresh.rideMaster.toJSON() : fresh.rideMaster;
  const sm =
    fresh.showMaster && typeof fresh.showMaster.toJSON === 'function' ? fresh.showMaster.toJSON() : fresh.showMaster;
  const rtm =
    fresh.restaurantMaster && typeof fresh.restaurantMaster.toJSON === 'function'
      ? fresh.restaurantMaster.toJSON()
      : fresh.restaurantMaster;

  const flat = flattenTypedValues(fresh.masterProfile || {}, rm || {}, sm || {}, rtm || {});
  const pc = profileCompleteness(req, flat, null);
  const prev = fresh.enrichment?.profileCompleteness;
  if (String(prev || '').toUpperCase() === String(pc).toUpperCase()) return false;

  const nextEnr = { ...(fresh.enrichment || {}), profileCompleteness: pc };
  await fresh.update({ enrichment: nextEnr }, { transaction });
  return true;
}

async function main() {
  if (ONLY_ZONE && ONLY_TYPE) {
    console.error('Wähle höchstens eine Option: --only-zone oder --only-type');
    process.exitCode = 1;
    return;
  }

  console.log('Europa-Park Master Data Update Summary');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  if (ONLY_ZONE) console.log('Scope: --only-zone');
  if (ONLY_TYPE) console.log('Scope: --only-type');
  if (SKIP_PROFILE_COMPLETENESS) console.log('Scope: --skip-profile-completeness');

  const europaPark = await findEuropaPark();
  if (!europaPark) {
    console.error('ABORT: Kein Platform-Park (europa-park / Europa-Park) gefunden.');
    process.exitCode = 1;
    return;
  }
  console.log(`Park: ${europaPark.name} (${europaPark.slug}) id=${europaPark.id}\n`);

  const typeRows = await AssetType.findAll({ attributes: ['id', 'code'] });
  const typeIdByCode = new Map(typeRows.map((t) => [t.code, t.id]));
  const rideTypeId = typeIdByCode.get('RIDE');

  const assets = await ParkAsset.findAll({
    where: { parkId: europaPark.id },
    include: [{ model: AssetType, as: 'assetType', attributes: ['code'], required: false }],
  });

  const rideAssets = assets.filter((a) => a.assetType?.code === 'RIDE' || a.assetTypeId === rideTypeId);
  const zones = await ParkZone.findAll({ where: { parkId: europaPark.id } });
  const zoneBySlug = buildZoneSlugMap(zones);

  const mdmCtx = await loadMdmContext();
  if (mdmCtx.mdmPark) {
    console.log(`MDM-Park: ${mdmCtx.mdmPark.name} (${mdmCtx.mdmPark.code}) — optionale mdm_rides.park_zone_id Sync.\n`);
  } else {
    console.log('Kein MDM-Park europa_park — nur Plattform-`park_assets` / `ride_master_data`.\n');
  }

  const needsReviewFound = [];
  const ambiguous = [];
  const planned = [];
  const ruleMatchedIndices = new Set();
  let zoneUpdates = 0;
  let typeUpdates = 0;
  let alreadyOk = 0;
  let mdmZoneUpdates = 0;
  let zonesCreated = 0;
  let profileCompletenessUpdates = 0;

  const scanned = rideAssets.length;
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  for (const asset of rideAssets) {
    const nr = needsReviewHit(asset);
    if (nr) {
      needsReviewFound.push({ asset: asset.name, slug: asset.slug, reason: nr.reason });
      continue;
    }

    const rules = rulesMatchingAsset(asset);
    if (rules.length === 0) continue;
    if (rules.length > 1) {
      ambiguous.push({
        asset: asset.name,
        slug: asset.slug,
        rules: rules.map((r) => r.slugs[0] || r.names[0]),
      });
      continue;
    }

    const rule = rules[0];
    const ruleIdx = EUROPA_PARK_MASTER_DATA_CORRECTIONS.indexOf(rule);
    ruleMatchedIndices.add(ruleIdx);

    const { zone: finalZone, slugUsed } = resolveZoneRow(zoneBySlug, rule.expectedZone);
    const willCreateZone = !finalZone && ZONES_AUTO_CREATE.has(String(slugUsed).toLowerCase());

    if (!finalZone && !willCreateZone) {
      planned.push({
        kind: 'skip_no_zone',
        asset: asset.name,
        slug: asset.slug,
        expectedZone: rule.expectedZone,
        slugHint: slugUsed,
      });
      continue;
    }

    const curZone = asset.zoneId ? zoneById.get(asset.zoneId) : null;
    const currentZoneName = curZone?.name || '—';

    let needZone = !ONLY_TYPE;
    if (finalZone) {
      needZone = needZone && String(asset.zoneId || '') !== String(finalZone.id);
    } else if (willCreateZone) {
      needZone = needZone && String(curZone?.slug || '').toLowerCase() !== String(slugUsed).toLowerCase();
    } else {
      needZone = false;
    }

    const rmd = await RideMasterData.findOne({ where: { assetId: asset.assetId } });
    const currentCategory = rmd?.rideCategory ?? null;
    const desiredCategory = rideCategoryValue(rule.expectedType);
    const desiredProfile = mergeAttractionClassification(asset.masterProfile, rule.expectedType, rule.typeConfidence);

    const needType =
      !ONLY_ZONE &&
      (String(currentCategory || '').toUpperCase() !== String(desiredCategory).toUpperCase() ||
        String(asset.masterProfile?.attractionClassification?.primaryType || '').toUpperCase() !==
          String(rule.expectedType).toUpperCase());

    if (!needZone && !needType) {
      alreadyOk += 1;
      continue;
    }

    const toZoneLabel = finalZone
      ? `${finalZone.name} (${finalZone.slug})`
      : `[would create slug=${slugUsed}]`;

    const line = `${asset.name}: zone ${currentZoneName} -> ${rule.expectedZone} (${toZoneLabel}), ride_category ${currentCategory || '—'} -> ${desiredCategory} (+ classification ${rule.expectedType})`;
    planned.push({
      kind: 'asset_update',
      line,
      needZone,
      needType,
      willCreateZone,
      slugUsed,
      desiredCategory,
      desiredProfile,
      rule,
      asset,
    });

    if (needZone) zoneUpdates += 1;
    if (needType) typeUpdates += 1;
  }

  const missingMapping = EUROPA_PARK_MASTER_DATA_CORRECTIONS.map((_, i) => i).filter((i) => !ruleMatchedIndices.has(i));

  const wouldCreateZoneSlugs = new Set(
    planned.filter((p) => p.kind === 'asset_update' && p.willCreateZone).map((p) => String(p.slugUsed).toLowerCase()),
  );

  console.log('Zones:');
  console.log(`${DRY_RUN ? '- would create' : '- created'}: ${DRY_RUN ? wouldCreateZoneSlugs.size : zonesCreated}`);
  console.log(`- existing: ${zones.length}`);
  console.log('\nAssets:');
  console.log(`- scanned: ${scanned}`);
  console.log(`- zone updates planned: ${zoneUpdates}`);
  console.log(`- type updates planned: ${typeUpdates}`);
  console.log(`- already correct: ${alreadyOk}`);
  console.log(`- ambiguous: ${ambiguous.length}`);
  console.log(`- missing mapping: ${missingMapping.length}`);
  console.log(`- needs review: ${needsReviewFound.length}`);

  if (planned.filter((p) => p.kind === 'asset_update').length) {
    console.log('\nPlanned changes:');
    for (const p of planned) {
      if (p.kind === 'asset_update') console.log(`- ${p.line}`);
    }
  }

  if (planned.filter((p) => p.kind === 'skip_no_zone').length) {
    console.log('\nSkipped (target park_zone missing in DB, not auto-created):');
    for (const p of planned) {
      if (p.kind === 'skip_no_zone')
        console.log(`- ${p.asset} (${p.slug}): ${p.expectedZone} (slug hint: ${p.slugHint})`);
    }
  }

  if (needsReviewFound.length) {
    console.log('\nNeeds review:');
    needsReviewFound.forEach((x) => console.log(`- ${x.asset} (${x.slug}): ${x.reason}`));
  }

  if (ambiguous.length) {
    console.log('\nAmbiguous (skipped):');
    ambiguous.slice(0, 20).forEach((x) => console.log(`- ${x.asset}: ${x.rules.join(' | ')}`));
  }

  if (missingMapping.length) {
    console.log('\nMissing mapping (no matching park_assets ride):');
    missingMapping.forEach((i) => {
      const r = EUROPA_PARK_MASTER_DATA_CORRECTIONS[i];
      console.log(`- ${r.slugs[0] || r.names[0]} → zone ${r.expectedZone}`);
    });
  }

  if (DRY_RUN) {
    console.log('\n(DRY RUN — keine Schreiboperationen.)');
    if (!SKIP_PROFILE_COMPLETENESS && planned.filter((p) => p.kind === 'asset_update').length) {
      console.log(
        'Hinweis: Beim echten Lauf wird `enrichment.profileCompleteness` für geänderte Assets neu gesetzt, sofern eine Vorlage mit Pflichtfeldern existiert.',
      );
    }
    return;
  }

  const ops = planned.filter((p) => p.kind === 'asset_update');
  if (!ops.length) {
    console.log('\nNichts anzuwenden.');
    return;
  }

  await sequelize.transaction(async (tx) => {
    let zlist = await ParkZone.findAll({ where: { parkId: europaPark.id }, transaction: tx });
    let zb = buildZoneSlugMap(zlist);
    const slugsToCreate = [
      ...new Set(ops.filter((o) => o.willCreateZone).map((o) => String(o.slugUsed).toLowerCase())),
    ].filter((sl) => !zb.get(sl));

    for (const sl of slugsToCreate) {
      const sortBase = await maxZoneSortOrder(europaPark.id, tx);
      const name = sl === 'hotels_resort' ? 'Hotels / Resort' : sl.replace(/_/g, ' ');
      const zoneRow = await ParkZone.create(
        {
          parkId: europaPark.id,
          name,
          slug: sl,
          sortOrder: sortBase + 10,
          parentZoneId: null,
          externalEntityId: null,
        },
        { transaction: tx },
      );
      zonesCreated += 1;
      zb.set(sl, zoneRow);
    }

    zlist = await ParkZone.findAll({ where: { parkId: europaPark.id }, transaction: tx });
    zb = buildZoneSlugMap(zlist);

    for (const op of ops) {
      const { zone: tz } = resolveZoneRow(zb, op.rule.expectedZone);
      if (!tz) {
        throw new Error(`Zone could not be resolved after apply start: ${op.rule.expectedZone} (${op.slugUsed})`);
      }

      const payload = {};
      if (op.needZone) payload.zoneId = tz.id;
      if (op.needType) payload.masterProfile = op.desiredProfile;

      const row = await ParkAsset.findByPk(op.asset.assetId, { transaction: tx });
      if (!row) throw new Error(`Missing park_asset ${op.asset.assetId}`);
      if (Object.keys(payload).length) await row.update(payload, { transaction: tx });

      if (op.needType) {
        let rmd = await RideMasterData.findOne({ where: { assetId: op.asset.assetId }, transaction: tx });
        if (!rmd) {
          await RideMasterData.create(
            { assetId: op.asset.assetId, rideCategory: op.desiredCategory },
            { transaction: tx },
          );
        } else {
          await rmd.update({ rideCategory: op.desiredCategory }, { transaction: tx });
        }
      }

      if (mdmCtx.mdmPark && op.needZone && mdmCtx.rides.length) {
        const mdmZ = resolveMdmZone(mdmCtx.zonesByCode, op.rule.expectedZone);
        const mdmRide = matchMdmRideToAsset(op.asset, mdmCtx.rides);
        if (mdmZ && mdmRide && mdmRide.parkZoneId !== mdmZ.id) {
          await mdmRide.update({ parkZoneId: mdmZ.id }, { transaction: tx });
          mdmZoneUpdates += 1;
        }
      }

      if (!SKIP_PROFILE_COMPLETENESS) {
        const synced = await syncProfileCompletenessForAsset(op.asset.assetId, tx);
        if (synced) profileCompletenessUpdates += 1;
      }
    }
  });

  console.log(`\nApplied. park_zones created: ${zonesCreated}`);
  console.log(`mdm_rides.park_zone_id updates: ${mdmZoneUpdates}`);
  console.log(`enrichment.profileCompleteness updates: ${profileCompletenessUpdates}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
