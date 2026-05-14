/* eslint-disable no-console */
'use strict';

/**
 * One-off / wiederholbar: Weist Europa-Park-`park_assets` (Rides, Shows, Restaurants)
 * per Name/Slug den Themengebieten (`park_zones`) zu, indiziert über strukturierte Konstanten.
 *
 * ## Führende Zuordnung (Plattform Master Data)
 * `park_assets.zone_id` → FK auf `park_zones.id`. Das ist die maßgebliche Spalte für
 * Asset-Daten / Operations.
 *
 * ## MDM (`mdm_rides`) — optional
 * `mdm_rides.park_zone_id` verweist auf **`mdm_park_zones.id`**, nicht auf `park_zones`.
 * UUIDs sind nicht austauschbar. Wenn ein MDM-Park `europa_park` existiert, versucht das
 * Script, passende `MdmRide`-Zeilen (nur Fahrgeschäfte) anhand von Name/`external_id`
 * zu finden und `park_zone_id` auf die **MDM**-Zone mit passendem `code` zu setzen.
 * Restaurants/Shows existieren nicht als `mdm_rides` — dort keine Aktion.
 * Fehlt die MDM-Zone oder der Ride, wird das in der Summary nur gezählt, kein Fehler.
 *
 * Keine Änderungen an anderen Parks.
 *
 * Usage:
 *   npm run mdm:update-europapark-zones
 *   npm run mdm:update-europapark-zones -- --dry-run
 */

require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { Op } = require('sequelize');
const {
  sequelize,
  Park,
  ParkZone,
  ParkAsset,
  AssetType,
  MdmPark,
  MdmParkZone,
  MdmRide,
} = require(path.join(__dirname, '..', 'src', 'models'));

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Themengebiet → Ride-/Restaurant-/Show-Namen (wie in Master Data / Marketing).
 * @type {Record<string, { rides: string[], restaurants: string[], shows: string[] }>}
 */
const EUROPA_PARK_ZONE_MAPPING = {
  Deutschland: {
    rides: [
      'Voletarium',
      'Elfenfahrt',
      'Oldtimer-Fahrt',
      'Jim Knopf – Reise durch Lummerland',
      'Marionetten-Bootsfahrt',
    ],
    restaurants: ['Schloss Balthasar Restaurant', 'Erdinger Weißbiergarten', 'Café Benedetto'],
    shows: ['Historama'],
  },
  Frankreich: {
    rides: ['Eurosat – CanCan Coaster', 'Euro-Tower'],
    restaurants: ['FoodLoop', 'Crêperie'],
    shows: ['Moulin Rouge Show'],
  },
  Island: {
    rides: [
      'blue fire Megacoaster',
      'WODAN – Timburcoaster',
      'Whale Adventures',
      'Snorri Touren',
    ],
    restaurants: ['Fjord Restaurant'],
    shows: [],
  },
  Schweiz: {
    rides: ['Matterhorn-Blitz', 'Schweizer Bobbahn', 'Jungfrau-Gletscherflieger'],
    restaurants: ['Walliser Stuben'],
    shows: [],
  },
  Österreich: {
    rides: [
      'Alpenexpress Enzian',
      'Alpenexpress Coastiality',
      'Tiroler Wildwasserbahn',
      'Josefinas kaiserliche Zauberreise',
    ],
    restaurants: ['Seehaus Restaurant'],
    shows: [],
  },
  Griechenland: {
    rides: ['Poseidon', 'Abenteuer Atlantis'],
    restaurants: ['Taverna Mykonos'],
    shows: [],
  },
  Portugal: {
    rides: ['Atlantica SuperSplash', 'Casa da Aventura'],
    restaurants: ['Casa Atlantica'],
    shows: [],
  },
  Holland: {
    rides: [
      'Piraten in Batavia',
      'Koffiekopjes',
      'Fliegender Holländer',
      'Roter Baron',
    ],
    restaurants: ['Bamboe Baai Restaurant'],
    shows: [],
  },
  Russland: {
    rides: ['Euro-Mir', 'Lada Autodrom', 'Schneeflöckchen'],
    restaurants: [],
    shows: [],
  },
  Spanien: {
    rides: ['Kolumbusjolle', 'Feria Swing'],
    restaurants: ['Don Quichotte Restaurant'],
    shows: ['Spanische Arena Shows'],
  },
  Italien: {
    rides: ['Geisterschloss', 'Volo da Vinci', 'Piccolo Mondo'],
    restaurants: ['Pizzeria Venezia'],
    shows: [],
  },
  Skandinavien: {
    rides: ['Fjord-Rafting'],
    restaurants: [],
    shows: [],
  },
  Irland: {
    rides: ['Ba-a-a Express', 'Dancing Dingie', 'Sheep Rock', 'Spinning Dragons'],
    restaurants: [],
    shows: [],
  },
  England: {
    rides: [],
    restaurants: [],
    shows: ['Globe Theatre Shows'],
  },
  'Königreich der Minimoys': {
    rides: ['Arthur', 'Poppy Tower', 'Wurzelrutschen'],
    restaurants: ['Jack’s DELI'],
    shows: [],
  },
  Kroatien: {
    rides: ['Voltron Nevera'],
    restaurants: [],
    shows: [],
  },
  Monaco: {
    rides: ['Silver Star'],
    restaurants: [],
    shows: [],
  },
  Abenteuerland: {
    rides: ['Dschungel-Floßfahrt'],
    restaurants: [],
    shows: [],
  },
  'Grimms Märchenwald': {
    rides: ['Märchenwald'],
    restaurants: [],
    shows: [],
  },
};

/** Display-Label → `park_zones.slug`-Kandidaten (Unterstriche, kompatibel zu MDM-Codes). */
const ZONE_SLUG_CANDIDATES = {
  Holland: ['niederlande', 'holland'],
  'Königreich der Minimoys': ['welt_der_kinder', 'koenigreich_der_minimoys'],
  'Grimms Märchenwald': ['grimms_maerchenwald'],
  Österreich: ['oesterreich'],
};

function slugCandidatesForZoneLabel(zoneLabel) {
  const c = ZONE_SLUG_CANDIDATES[zoneLabel];
  if (c?.length) return c;
  return [slugFromCode(zoneLabel)];
}

/** MDM `mdm_park_zones.code`-Kandidaten. */
function mdmCodesForZoneLabel(zoneLabel) {
  const m = {
    Holland: ['niederlande', 'holland'],
    'Königreich der Minimoys': ['welt_der_kinder', 'koenigreich_der_minimoys'],
    Monaco: ['monaco', 'frankreich'],
    Österreich: ['oesterreich'],
  };
  if (m[zoneLabel]?.length) return m[zoneLabel];
  return slugCandidatesForZoneLabel(zoneLabel);
}

function slugFromCode(code) {
  let s = String(code || '').trim().toLowerCase();
  s = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  s = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (s || 'zone').slice(0, 128);
}

function normalizeLabel(input) {
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

/**
 * Zusätzliche Bezeichner pro Mapping-Label (Marketing vs. DB/Wiki/`short_name`), v. a. wie in
 * `scripts/update-europa-park-ride-capacity-targets.js`.
 * Schlüssel müssen exakt dem String in {@link EUROPA_PARK_ZONE_MAPPING} entsprechen.
 */
const MAPPING_LABEL_ALIASES = {
  Elfenfahrt: ['Elven Flight', 'Elven flight', 'elf ride', 'elfen fahrt'],
  'Oldtimer-Fahrt': ['Oldtimer Fahrt', 'Oldtimer', 'Vintage Cars', 'vintage cars'],
  'Jim Knopf – Reise durch Lummerland': [
    'Jim Knopf - Reise durch Lummerland',
    'jim knopf',
    'reise durch lummerland',
    'jim button journey through morrowland',
    'jim_button_journey_through_morrowland',
  ],
  'Marionetten-Bootsfahrt': [
    'Marionetten Bootsfahrt',
    'Marionettenbootsfahrt',
    'puppet boat ride',
    'puppet boat',
  ],
  'Schloss Balthasar Restaurant': ['Schloss Balthasar', 'Balthasar', 'castle balthasar', 'schloss balthasar'],
  'Erdinger Weißbiergarten': [
    'Erdinger Weissbiergarten',
    'Erdinger',
    'Weissbiergarten',
    'Erdinger Weisse',
  ],
  'Café Benedetto': ['Cafe Benedetto', 'Benedetto'],
  Historama: [],
  'Moulin Rouge Show': ['Moulin Rouge', 'moulin rouge paris'],
  'Eurosat – CanCan Coaster': [
    'Eurosat - CanCan Coaster',
    'Eurosat CanCan Coaster',
    'eurosat cancan coaster',
    'eurosat',
    'cancan coaster',
    'eurosat_cancan_coaster',
  ],
  'Euro-Tower': ['Euro Tower', 'euro tower', 'euro_tower', 'eurotower'],
  Crêperie: ['Creperie'],
  'WODAN – Timburcoaster': ['WODAN - Timburcoaster', 'wodan timburcoaster', 'wodan'],
  'blue fire Megacoaster': ['blue fire', 'blue_fire'],
  'Whale Adventures': ['Whale Adventures Arctic', 'whale adventure'],
  'Snorri Touren': ['snorri touren', 'snorri', 'snorri_touren'],
  'Schweizer Bobbahn': ['schweizer bobbahn', 'swiss bob run', 'swiss_bob_run', 'swiss bob'],
  'Jungfrau-Gletscherflieger': ['Jungfrau Gletscherflieger', 'jungfrau gletscherflieger', 'gletscherflieger'],
  'Walliser Stuben': ['Walliser Stuben Restaurant', 'Walliser'],
  'Alpenexpress Enzian': [
    'Alpenexpress Enzian',
    'alpenexpress enzian',
    'alpenexpress_enzian',
    'alpine express enzian',
  ],
  'Alpenexpress Coastiality': ['alpenexpress coastiality', 'alpenexpress_coastiality', 'coastiality'],
  'Tiroler Wildwasserbahn': [
    'tiroler wildwasserbahn',
    'wildwasserbahn',
    'tirol log flume',
    'tirol_log_flume',
  ],
  'Josefinas kaiserliche Zauberreise': [
    'Josefina',
    'Josefinas Kaiserliche Zauberreise',
    'kaiserliche zauberreise',
    'josefinas zauberreise',
  ],
  'Seehaus Restaurant': ['Seehaus'],
  'Abenteuer Atlantis': ['Atlantis Adventure', 'Abenteuer atlantis', 'atlantis'],
  'Piraten in Batavia': ['piraten in batavia', 'batavia', 'pirates_in_batavia', 'Pirates in Batavia'],
  'Fliegender Holländer': [
    'Fliegender Hollander',
    'Flying Dutchman',
    'flying dutchman',
    'fliegender hollaender',
  ],
  'Roter Baron': ['Red Baron', 'red baron', 'roter baron'],
  'Bamboe Baai Restaurant': ['Bamboe Baai', 'bamboo bay', 'bamboe baai'],
  Schneeflöckchen: ['Schneefloeckchen', 'snowflake', 'schneefloeckchen ride'],
  'Don Quichotte Restaurant': ['Don Quichotte', 'Don Quixote', 'don quixote'],
  'Spanische Arena Shows': ['Spanische Arena', 'Spanish arena', 'spanische arena shows'],
  Geisterschloss: ['ghost castle', 'geisterschloss italy', 'Ghost Castle'],
  'Globe Theatre Shows': ['Globe Theatre', 'Shakespeare Globe', 'globe theatre', 'Globe Theatre london'],
  Voletarium: [],
  FoodLoop: ['food loop'],
  Arthur: ['ARTHUR'],
  'Voltron Nevera': [
    'Voltron Nevera powered by Rimac',
    'voltron nevera powered by rimac',
    'voltron nevera',
    'voltron',
  ],
  'Dschungel-Floßfahrt': ['Dschungel-Flossfahrt', 'dschungel flossfahrt', 'dschungel_flossfahrt'],
  'Märchenwald': ['Maerchenwald', 'marchenwald'],
  'Fjord-Rafting': ['Fjord Rafting', 'fjord rafting', 'fjord', 'fjord_rafting'],
  Koffiekopjes: ['coffee cups', 'koffiekopjes'],
};

function mappingMatchTargets(mappingLabel) {
  const extras = MAPPING_LABEL_ALIASES[mappingLabel];
  const raw = extras && extras.length ? [mappingLabel, ...extras] : [mappingLabel];
  const set = new Set();
  for (const r of raw) {
    const n = normalizeLabel(r);
    if (n) set.add(n);
  }
  return [...set];
}

function assetNormVariants(asset) {
  const fields = [asset.name, asset.shortName, asset.slug, asset.zoneLabel];
  const set = new Set();
  for (const f of fields) {
    if (f == null || f === '') continue;
    const n = normalizeLabel(f);
    if (n) set.add(n);
  }
  const slugSpaced = normalizeLabel(String(asset.slug || '').replace(/[-_]+/g, ' '));
  if (slugSpaced) set.add(slugSpaced);
  return [...set];
}

/**
 * MDM-Rides matchen gegen **Plattform-Asset** (Name/Slug/extern), nicht nur gegen das Mapping-Label —
 * ThemeParks-Namen weichen oft vom Tabellentext ab.
 */
function matchMdmRideUnique(mdmRides, asset, mappingLabel) {
  const candidateNorms = new Set();
  for (const raw of [
    mappingLabel,
    asset.name,
    asset.shortName,
    asset.slug,
    asset.zoneLabel,
    ...(MAPPING_LABEL_ALIASES[mappingLabel] || []),
  ]) {
    const n = normalizeLabel(raw);
    if (n) candidateNorms.add(n);
  }
  for (const t of mappingMatchTargets(mappingLabel)) candidateNorms.add(t);

  const byExact = mdmRides.filter((r) => {
    if (asset.externalEntityId && r.externalId && String(r.externalId) === String(asset.externalEntityId))
      return true;
    const rn = normalizeLabel(r.name);
    return candidateNorms.has(rn);
  });
  if (byExact.length === 1) return { status: 'unique', ride: byExact[0] };
  if (byExact.length > 1) return { status: 'ambiguous', rides: byExact };

  const MIN = 4;
  const an = normalizeLabel(asset.name);
  const byFuzzy = mdmRides.filter((r) => {
    const rn = normalizeLabel(r.name);
    if (an.length >= MIN && rn.length >= MIN && (rn.includes(an) || an.includes(rn))) return true;
    return false;
  });
  if (byFuzzy.length === 1) return { status: 'unique', ride: byFuzzy[0] };
  if (byFuzzy.length > 1) return { status: 'ambiguous', rides: byFuzzy };

  return { status: 'none' };
}

/**
 * @param {import('sequelize').Model[]} assetsSameType
 * @param {string} mappingLabel
 */
function matchAsset(assetsSameType, mappingLabel) {
  const targets = mappingMatchTargets(mappingLabel);
  if (!targets.length) return { status: 'none' };

  const exact = assetsSameType.filter((a) => {
    const vars = assetNormVariants(a);
    return vars.some((v) => targets.includes(v));
  });
  if (exact.length === 1) return { status: 'unique', asset: exact[0] };
  if (exact.length > 1) return { status: 'ambiguous', matches: exact };

  const MIN = 4;
  const fuzzy = assetsSameType.filter((a) => {
    const vars = assetNormVariants(a);
    for (const v of vars) {
      for (const t of targets) {
        if (v.length >= MIN && t.length >= MIN && (v.includes(t) || t.includes(v))) return true;
      }
    }
    return false;
  });
  if (fuzzy.length === 1) return { status: 'unique', asset: fuzzy[0] };
  if (fuzzy.length > 1) return { status: 'ambiguous', matches: fuzzy };

  const tokenMatched = assetsSameType.filter((a) => {
    const combined = assetNormVariants(a).join(' ');
    for (const t of targets) {
      const tokens = t.split(' ').filter((w) => w.length >= 3);
      if (tokens.length && tokens.every((tok) => combined.includes(tok))) return true;
    }
    return false;
  });
  if (tokenMatched.length === 1) return { status: 'unique', asset: tokenMatched[0] };
  if (tokenMatched.length > 1) return { status: 'ambiguous', matches: tokenMatched };

  return { status: 'none' };
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

async function resolveParkZone(platformParkId, zoneLabel) {
  const candidates = slugCandidatesForZoneLabel(zoneLabel);
  for (const slug of candidates) {
    const z = await ParkZone.findOne({ where: { parkId: platformParkId, slug } });
    if (z) return { zone: z, createSlug: candidates[0], createName: zoneLabel };
  }
  return { zone: null, createSlug: candidates[0], createName: zoneLabel };
}

async function maxSortOrder(platformParkId) {
  const row = await ParkZone.findOne({
    attributes: [[sequelize.fn('MAX', sequelize.col('sort_order')), 'm']],
    where: { parkId: platformParkId },
    raw: true,
  });
  return Number(row?.m) || 0;
}

async function loadMdmContext() {
  const mdmPark = await MdmPark.findOne({
    where: { code: { [Op.in]: ['europa_park', 'europa-park'] } },
  });
  if (!mdmPark) {
    return { mdmPark: null, mdmZonesByCode: new Map() };
  }
  const zones = await MdmParkZone.findAll({ where: { parkId: mdmPark.id } });
  const mdmZonesByCode = new Map();
  for (const z of zones) {
    mdmZonesByCode.set(String(z.code || '').toLowerCase(), z);
  }
  return { mdmPark, mdmZonesByCode };
}

function resolveMdmZone(mdmZonesByCode, zoneLabel) {
  for (const code of mdmCodesForZoneLabel(zoneLabel)) {
    const z = mdmZonesByCode.get(String(code).toLowerCase());
    if (z) return z;
  }
  return null;
}

async function main() {
  console.log(`Europa-Park asset zones — mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'APPLY'}\n`);

  const europaPark = await findEuropaPark();
  if (!europaPark) {
    console.error('ABORT: Kein Platform-Park (slug europa-park / Name Europa-Park) gefunden.');
    process.exitCode = 1;
    return;
  }
  console.log(`Platform-Park: ${europaPark.name} (${europaPark.slug}) id=${europaPark.id}\n`);

  const typeRows = await AssetType.findAll({
    where: { code: { [Op.in]: ['RIDE', 'SHOW', 'RESTAURANT'] } },
  });
  const typeIdByCode = new Map(typeRows.map((t) => [t.code, t.id]));
  for (const c of ['RIDE', 'SHOW', 'RESTAURANT']) {
    if (!typeIdByCode.has(c)) console.warn(`WARN: asset_types code ${c} fehlt — Matching eingeschränkt.`);
  }

  const assets = await ParkAsset.findAll({
    where: { parkId: europaPark.id },
    include: [{ model: AssetType, as: 'assetType', attributes: ['code'], required: false }],
  });

  const byKind = {
    RIDE: assets.filter((a) => a.assetType?.code === 'RIDE'),
    SHOW: assets.filter((a) => a.assetType?.code === 'SHOW'),
    RESTAURANT: assets.filter((a) => a.assetType?.code === 'RESTAURANT'),
  };

  const { mdmPark, mdmZonesByCode } = await loadMdmContext();
  if (mdmPark) {
    console.log(`MDM-Park gefunden: ${mdmPark.name} (${mdmPark.code}) — optionale mdm_rides-Sync.\n`);
  } else {
    console.log('Kein MDM-Park europa_park — nur park_assets werden bearbeitet.\n');
  }

  const mdmRides = mdmPark
    ? await MdmRide.findAll({ where: { parkId: mdmPark.id } })
    : [];

  let updatedAssets = 0;
  let skippedAssets = 0;
  let createdZones = 0;
  let simulatedZones = 0;
  const missingAssets = [];
  const ambiguousAssets = [];
  const planned = [];
  let updatedMdmRides = 0;
  let skippedMdmRides = 0;
  const mdmAmbiguous = [];
  const mdmMissingZone = [];
  const mdmMissingRide = [];

  const zoneCache = new Map();

  for (const [zoneLabel, groups] of Object.entries(EUROPA_PARK_ZONE_MAPPING)) {
    let parkZone = zoneCache.get(zoneLabel);
    let dryRunNewZoneSlug = null;

    if (!parkZone) {
      const resolved = await resolveParkZone(europaPark.id, zoneLabel);
      if (resolved.zone) {
        parkZone = resolved.zone;
        zoneCache.set(zoneLabel, parkZone);
      } else {
        const sortBase = await maxSortOrder(europaPark.id);
        const newSlug = resolved.createSlug;
        const newName = resolved.createName;
        planned.push({
          action: 'create_zone',
          zoneLabel,
          slug: newSlug,
          name: newName,
        });
        if (!DRY_RUN) {
          parkZone = await ParkZone.create({
            parkId: europaPark.id,
            name: newName,
            slug: newSlug,
            sortOrder: sortBase + 10,
            parentZoneId: null,
            externalEntityId: null,
          });
          zoneCache.set(zoneLabel, parkZone);
          createdZones += 1;
          console.log(`[zone] created park_zones slug=${newSlug} name=${newName}`);
        } else {
          dryRunNewZoneSlug = newSlug;
          simulatedZones += 1;
          console.log(`[dry-run] would create park_zones slug=${newSlug} name=${newName}`);
        }
      }
    }

    const targetZoneId = parkZone?.id ?? null;

    /**
     * @param {'rides'|'shows'|'restaurants'} kind
     * @param {string[]} list
     */
    const runKind = async (kind, list) => {
      const code = kind === 'rides' ? 'RIDE' : kind === 'shows' ? 'SHOW' : 'RESTAURANT';
      const pool = byKind[code] || [];

      for (const label of list) {
        const m = matchAsset(pool, label);
        if (m.status === 'none') {
          missingAssets.push({ zone: zoneLabel, kind: code, label });
          continue;
        }
        if (m.status === 'ambiguous') {
          ambiguousAssets.push({
            zone: zoneLabel,
            kind: code,
            label,
            assetIds: m.matches.map((a) => a.assetId),
            names: m.matches.map((a) => a.name),
          });
          continue;
        }
        const asset = m.asset;

        if (!targetZoneId) {
          if (DRY_RUN && dryRunNewZoneSlug) {
            planned.push({
              action: 'update_asset',
              assetId: asset.assetId,
              name: asset.name,
              fromZoneId: asset.zoneId,
              toZoneId: `(new zone slug=${dryRunNewZoneSlug})`,
              zoneLabel,
            });
            updatedAssets += 1;
            console.log(
              `[dry-run] asset ${asset.name} (${asset.assetId}) zone_id ${asset.zoneId ?? 'null'} → new zone slug=${dryRunNewZoneSlug} (${zoneLabel})`,
            );
          } else {
            skippedAssets += 1;
          }
        } else if (asset.zoneId === targetZoneId) {
          skippedAssets += 1;
        } else {
          planned.push({
            action: 'update_asset',
            assetId: asset.assetId,
            name: asset.name,
            slug: asset.slug,
            fromZoneId: asset.zoneId,
            toZoneId: targetZoneId,
            zoneLabel,
          });
          if (!DRY_RUN) {
            await asset.update({ zoneId: targetZoneId });
            updatedAssets += 1;
            console.log(`[asset] ${asset.name} → zone ${zoneLabel} (${targetZoneId})`);
          } else {
            updatedAssets += 1;
            console.log(
              `[dry-run] asset ${asset.name} (${asset.assetId}) zone_id ${asset.zoneId ?? 'null'} → ${targetZoneId} (${zoneLabel})`,
            );
          }
        }

        if (code === 'RIDE' && mdmPark) {
          const mdmZone = resolveMdmZone(mdmZonesByCode, zoneLabel);
          if (!mdmZone) {
            mdmMissingZone.push({ zoneLabel, label });
            continue;
          }
          const mdmMatch = matchMdmRideUnique(mdmRides, asset, label);
          if (mdmMatch.status !== 'unique') {
            if (mdmMatch.status === 'none') mdmMissingRide.push({ label, zoneLabel, assetName: asset.name });
            else mdmAmbiguous.push({ label, ids: mdmMatch.rides.map((r) => r.id) });
            continue;
          }
          const mr = mdmMatch.ride;
          if (mr.parkZoneId === mdmZone.id) {
            skippedMdmRides += 1;
            continue;
          }
          planned.push({
            action: 'update_mdm_ride',
            mdmRideId: mr.id,
            name: mr.name,
            fromMdmZoneId: mr.parkZoneId,
            toMdmZoneId: mdmZone.id,
            mdmZoneCode: mdmZone.code,
          });
          if (!DRY_RUN) {
            await mr.update({ parkZoneId: mdmZone.id });
            updatedMdmRides += 1;
            console.log(`[mdm_ride] ${mr.name} → mdm_park_zones.code=${mdmZone.code}`);
          } else {
            updatedMdmRides += 1;
            console.log(
              `[dry-run] mdm_ride ${mr.name} (${mr.id}) park_zone_id ${mr.parkZoneId} → ${mdmZone.id} (${mdmZone.code})`,
            );
          }
        }
      }
    };

    await runKind('rides', groups.rides || []);
    await runKind('restaurants', groups.restaurants || []);
    await runKind('shows', groups.shows || []);
  }

  console.log('\n--- Summary ---');
  console.log(`Platform park_assets zone updates: ${updatedAssets}${DRY_RUN ? ' (simulated)' : ''}`);
  console.log(`Platform park_assets skipped (unchanged / no op): ${skippedAssets}`);
  if (DRY_RUN) {
    console.log(`Park zones would be created: ${simulatedZones}`);
  } else {
    console.log(`Park zones created: ${createdZones}`);
  }
  console.log(`Missing asset matches: ${missingAssets.length}`);
  console.log(`Ambiguous asset matches: ${ambiguousAssets.length}`);
  console.log(`mdm_rides zone updates: ${updatedMdmRides}${DRY_RUN ? ' (simulated)' : ''}`);
  console.log(`mdm_rides skipped (unchanged): ${skippedMdmRides}`);
  console.log(`mdm missing zone code: ${mdmMissingZone.length}`);
  console.log(`mdm ride not matched: ${mdmMissingRide.length}`);
  console.log(`mdm ambiguous: ${mdmAmbiguous.length}`);

  if (missingAssets.length) {
    console.log('\nMissing assets (sample up to 25):');
    missingAssets.slice(0, 25).forEach((x) => console.log(`  - [${x.zone}] ${x.kind} "${x.label}"`));
    if (missingAssets.length > 25) console.log(`  … +${missingAssets.length - 25} more`);
  }
  if (ambiguousAssets.length) {
    console.log('\nAmbiguous (skipped):');
    ambiguousAssets.slice(0, 15).forEach((x) => {
      console.log(`  - [${x.zone}] ${x.kind} "${x.label}": ${x.names.join(' | ')}`);
    });
  }
  if (mdmMissingZone.length) {
    console.log('\nMDM: no zone code for label (sample):');
    mdmMissingZone.slice(0, 10).forEach((x) => console.log(`  - ${x.zoneLabel} (${x.label})`));
  }

  if (DRY_RUN && planned.length) {
    console.log(`\nPlanned operation records: ${planned.length} (see logs above).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
