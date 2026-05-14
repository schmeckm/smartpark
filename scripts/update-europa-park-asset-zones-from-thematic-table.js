/* eslint-disable no-console */
'use strict';

/**
 * Ordnet ausgewählte Europa-Park-Assets den Themengebiet-Zonen (`park_zones`, Slugs aus MDM)
 * zu und schreibt `masterProfile.smartParkCategory` gemäß Referenztabelle.
 *
 * Voraussetzung: `npm run migrate:mdm-zones-to-park-zones` (oder gleichwertig), damit
 * `park_zones.slug` den MDM-Codes entspricht (z. B. deutschland, frankreich, grimms_maerchenwald).
 *
 * Rulantica: Assets werden in `europa_park` und optional im separaten Park `rulantica` gesucht;
 * Ziel-`zone_id` stammt immer aus demselben Park wie das Asset.
 *
 * Zeilen ohne Treffer in `park_assets` (z. B. fehlender Anbieter-Import): `unmatched` loggen und bei
 * bekanntem Slug `explicitSlugs` in `ROWS` ergänzen — siehe z. B. `Panorama-Bahn` (Deutschland).
 *
 * Usage:
 *   node scripts/update-europa-park-asset-zones-from-thematic-table.js
 *   node scripts/update-europa-park-asset-zones-from-thematic-table.js --apply
 */

require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { Op } = require('sequelize');
const { sequelize, Park, ParkZone, ParkAsset, AssetType } = require(path.join(__dirname, '..', 'src', 'models'));

const DRY = !process.argv.includes('--apply');

/** Anzeigename Referenztabelle → `park_zones.slug` (nach MDM-Zone `code`). */
const ZONE_LABEL_TO_SLUG = {
  Deutschland: 'deutschland',
  Frankreich: 'frankreich',
  Italien: 'italien',
  Spanien: 'spanien',
  Griechenland: 'griechenland',
  Island: 'island',
  Skandinavien: 'skandinavien',
  Österreich: 'oesterreich',
  Schweiz: 'schweiz',
  Russland: 'russland',
  Portugal: 'portugal',
  Irland: 'irland',
  Niederlande: 'niederlande',
  England: 'england',
  Kroatien: 'kroatien',
  Abenteuerland: 'abenteuerland',
  'Grimms Märchenwald': 'grimms_maerchenwald',
  Rulantica: 'rulantica',
};

/** @typedef {{ zone: keyof typeof ZONE_LABEL_TO_SLUG, kind: 'RIDE'|'SHOW'|'RESTAURANT', name: string, smartParkCategory: string, aliases?: string[], explicitSlugs?: string[] }} ThematicRow */

/** @type {ThematicRow[]} */
const ROWS = [
  { zone: 'Deutschland', kind: 'RIDE', name: 'Euro-Tower', smartParkCategory: 'Observation Tower', aliases: ['euro tower', 'euro-tower', 'euro_tower', 'eurotower'] },
  {
    zone: 'Deutschland',
    kind: 'RIDE',
    name: 'Panorama-Bahn',
    smartParkCategory: 'Transport Ride',
    aliases: ['panorama bahn', 'panoramabahn', 'panorama-bahn'],
    explicitSlugs: ['panorama_train_station_germany'],
  },
  { zone: 'Deutschland', kind: 'RESTAURANT', name: 'Schloss Balthasar', smartParkCategory: 'Fine Dining', aliases: ['schloss balthasar', 'balthasar'] },
  { zone: 'Frankreich', kind: 'RIDE', name: 'Silver Star', smartParkCategory: 'Rollercoaster', aliases: ['silver star', 'silver_star'] },
  {
    zone: 'Frankreich',
    kind: 'RIDE',
    name: 'Eurosat CanCan Coaster',
    smartParkCategory: 'Indoor Coaster',
    aliases: ['eurosat cancan coaster', 'eurosat cancan', 'eurosat', 'cancan coaster', 'eurosat_cancan_coaster'],
  },
  { zone: 'Frankreich', kind: 'RESTAURANT', name: 'Petite France', smartParkCategory: 'Restaurant', aliases: ['petite france', 'petit france', 'petit_france', 'restaurant_petite_france', 'restaurant_petit_france'] },
  { zone: 'Italien', kind: 'RIDE', name: 'Volo da Vinci', smartParkCategory: 'Family Ride', aliases: ['volo da vinci', 'volo_da_vinci'] },
  { zone: 'Italien', kind: 'RIDE', name: 'Geisterschloss', smartParkCategory: 'Dark Ride', aliases: ['geisterschloss', 'ghost castle', 'geisterschloss italy'] },
  { zone: 'Italien', kind: 'RESTAURANT', name: 'Pizzeria Venezia', smartParkCategory: 'Restaurant', aliases: ['pizzeria venezia', 'pizzeria_venezia', 'venezia'] },
  { zone: 'Spanien', kind: 'RIDE', name: 'Kolumbusjolle', smartParkCategory: 'Water Ride', aliases: ['kolumbusjolle', 'kolumbus'] },
  { zone: 'Spanien', kind: 'RIDE', name: 'Feria Swing', smartParkCategory: 'Flat Ride', aliases: ['feria swing', 'feria_swing'] },
  {
    zone: 'Spanien',
    kind: 'SHOW',
    name: 'Arena Show',
    smartParkCategory: 'Live Entertainment',
    aliases: ['arena show', 'arena_show', 'arena de toros', 'spanish arena', 'anfiteatro'],
    explicitSlugs: ['anfiteatro_dell_aqua'],
  },
  { zone: 'Griechenland', kind: 'RIDE', name: 'Poseidon', smartParkCategory: 'Water Coaster', aliases: ['poseidon'] },
  { zone: 'Griechenland', kind: 'RESTAURANT', name: 'Taverna Mykonos', smartParkCategory: 'Restaurant', aliases: ['taverna mykonos', 'taverna_mykonos', 'mykonos'] },
  { zone: 'Island', kind: 'RIDE', name: 'blue fire Megacoaster', smartParkCategory: 'Launch Coaster', aliases: ['blue fire megacoaster', 'blue fire', 'blue_fire'] },
  { zone: 'Island', kind: 'RIDE', name: 'Wodan Timburcoaster', smartParkCategory: 'Wooden Coaster', aliases: ['wodan timburcoaster', 'wodan', 'wodan_timburcoaster'] },
  { zone: 'Island', kind: 'RESTAURANT', name: 'Fjord Restaurant', smartParkCategory: 'Restaurant', aliases: ['fjord restaurant', 'fjord-restaurant', 'fjord_restaurant'] },
  { zone: 'Skandinavien', kind: 'RIDE', name: 'Snorri Touren', smartParkCategory: 'Dark Ride', aliases: ['snorri touren', 'snorri'] },
  { zone: 'Skandinavien', kind: 'RESTAURANT', name: 'Bubba Svens', smartParkCategory: 'Restaurant', aliases: ['bubba svens', 'bubba_svens'] },
  { zone: 'Österreich', kind: 'RIDE', name: 'Alpenexpress Enzian', smartParkCategory: 'Powered Coaster', aliases: ['alpenexpress enzian', 'alpenexpress_enzian', 'alpenexpress'] },
  {
    zone: 'Österreich',
    kind: 'RIDE',
    name: 'Tiroler Wildwasserbahn',
    smartParkCategory: 'Log Flume',
    aliases: ['tiroler wildwasserbahn', 'wildwasserbahn', 'tiroler_wildwasserbahn', 'tirol log flume'],
    explicitSlugs: ['tirol_log_flume'],
  },
  { zone: 'Österreich', kind: 'RESTAURANT', name: "ERDINGER Hütt'n", smartParkCategory: 'Restaurant', aliases: ['erdinger', 'erdinger hutten', 'erdinger hutt', 'erdinger_hutten'] },
  { zone: 'Schweiz', kind: 'RIDE', name: 'Matterhorn-Blitz', smartParkCategory: 'Wild Mouse Coaster', aliases: ['matterhorn blitz', 'matterhorn-blitz', 'matterhorn_blitz'] },
  { zone: 'Schweiz', kind: 'RESTAURANT', name: 'Walliser Stuben', smartParkCategory: 'Restaurant', aliases: ['walliser stuben', 'walliser_stuben'] },
  { zone: 'Russland', kind: 'RIDE', name: 'Euro-Mir', smartParkCategory: 'Spinning Coaster', aliases: ['euro mir', 'euro-mir', 'euromir', 'euro_mir'] },
  {
    zone: 'Russland',
    kind: 'RESTAURANT',
    name: 'Café Russland',
    smartParkCategory: 'Café',
    aliases: ['cafe russland', 'café russland', 'cafe_russland', 'cmak', 'russian food'],
    explicitSlugs: ['cmak_russian_food_burger'],
  },
  { zone: 'Portugal', kind: 'RIDE', name: 'Atlantica SuperSplash', smartParkCategory: 'Water Ride', aliases: ['atlantica supersplash', 'atlantica_supersplash'] },
  { zone: 'Portugal', kind: 'RESTAURANT', name: 'Casa Atlântica', smartParkCategory: 'Restaurant', aliases: ['casa atlantica', 'casa atlântica', 'casa_atlantica'] },
  { zone: 'Irland', kind: 'RIDE', name: 'Ba-aa Express', smartParkCategory: 'Children Ride', aliases: ['ba-a-a express', 'ba a a express', 'ba_a_a_express', 'baaa express'] },
  { zone: 'Irland', kind: 'RIDE', name: 'Dancing Dingie', smartParkCategory: 'Children Ride', aliases: ['dancing dingie', 'dancing dinghy', 'dancing_dinghy'] },
  { zone: 'Irland', kind: 'RESTAURANT', name: "The O'Mackay's Café and Pub", smartParkCategory: 'Pub', aliases: ['o mackay', 'omackay', 'mackay', 'o_mackays'] },
  { zone: 'Niederlande', kind: 'RIDE', name: 'Piraten in Batavia', smartParkCategory: 'Dark Ride', aliases: ['piraten in batavia', 'pirates in batavia', 'piraten_in_batavia'] },
  { zone: 'Niederlande', kind: 'RESTAURANT', name: 'Hacienda Don Quichotte', smartParkCategory: 'Restaurant', aliases: ['hacienda don quichotte', 'don quichotte', 'hacienda_don_quichotte'] },
  { zone: 'England', kind: 'SHOW', name: 'Globe Theatre Show', smartParkCategory: 'Live Show', aliases: ['globe theatre', 'globe theater', 'globe_theatre_show'] },
  { zone: 'England', kind: 'RESTAURANT', name: 'Tea Time Café', smartParkCategory: 'Café', aliases: ['tea time cafe', 'tea time café', 'tea_time_cafe'] },
  { zone: 'Kroatien', kind: 'RIDE', name: 'Voltron Nevera', smartParkCategory: 'Multi Launch Coaster', aliases: ['voltron nevera', 'voltron', 'voltron nevera powered by rimac'] },
  { zone: 'Kroatien', kind: 'RESTAURANT', name: 'Croatia Snack Bar', smartParkCategory: 'Snack Bar', aliases: ['croatia snack', 'croatia_snack_bar'] },
  { zone: 'Abenteuerland', kind: 'RIDE', name: 'Abenteuer-Spielplatz', smartParkCategory: 'Playground', aliases: ['abenteuer spielplatz', 'abenteuer-spielplatz', 'adventure playground'] },
  { zone: 'Grimms Märchenwald', kind: 'RIDE', name: 'Märchenfahrt', smartParkCategory: 'Family Ride', aliases: ['marchenfahrt', 'märchenfahrt', 'marchen fahrt'] },
  { zone: 'Rulantica', kind: 'RIDE', name: 'Vinter Rytt', smartParkCategory: 'Water Slide', aliases: ['vinter rytt', 'vinter_rytt', 'vinter ryt'] },
  { zone: 'Rulantica', kind: 'RESTAURANT', name: 'Lumålunda', smartParkCategory: 'Restaurant', aliases: ['lumalunda', 'lumålunda', 'luma lunda'] },
];

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * @param {import('sequelize').Model|null} park
 * @param {string} zoneSlug
 */
async function resolveZoneIdForPark(park, zoneSlug) {
  if (!park) return null;
  let z = await ParkZone.findOne({
    where: { parkId: park.id, slug: { [Op.iLike]: zoneSlug } },
  });
  if (!z && zoneSlug === 'rulantica' && park.slug === 'rulantica') {
    z = await ParkZone.findOne({
      where: {
        parkId: park.id,
        [Op.or]: [{ slug: { [Op.iLike]: 'general' } }, { name: { [Op.iLike]: '%general%' } }],
      },
    });
  }
  return z ? z.id : null;
}

async function main() {
  const parkEuropa = await Park.findOne({ where: { slug: 'europa_park' } });
  if (!parkEuropa) throw new Error('Park not found: europa_park');
  const parkRulantica = await Park.findOne({ where: { slug: 'rulantica' } });

  const parkBySlug = new Map([['europa_park', parkEuropa]]);
  if (parkRulantica) parkBySlug.set('rulantica', parkRulantica);

  const zoneSlugSet = new Set(Object.values(ZONE_LABEL_TO_SLUG));
  /** @type {Map<string, Map<string, string|null>>} parkSlug -> zoneSlug -> zoneId */
  const zoneIdByParkAndSlug = new Map();
  for (const ps of parkBySlug.keys()) {
    const park = parkBySlug.get(ps);
    const inner = new Map();
    for (const zs of zoneSlugSet) {
      inner.set(zs, await resolveZoneIdForPark(park, zs));
    }
    zoneIdByParkAndSlug.set(ps, inner);
  }

  const parkIds = [...parkBySlug.values()].map((p) => p.id);
  const rows = await ParkAsset.findAll({
    where: { parkId: { [Op.in]: parkIds } },
    attributes: ['assetId', 'parkId', 'slug', 'name', 'zoneId', 'zoneLabel', 'masterProfile'],
    include: [{ model: AssetType, as: 'assetType', attributes: ['code'], required: true }],
  });

  function parkSlugForAssetParkId(parkId) {
    if (parkId === parkEuropa.id) return 'europa_park';
    if (parkRulantica && parkId === parkRulantica.id) return 'rulantica';
    return 'other';
  }

  const assets = rows.map((r) => {
    const at = r.assetType?.code || '';
    const parkSlug = parkSlugForAssetParkId(r.parkId);
    return {
      assetId: String(r.assetId),
      parkId: String(r.parkId),
      parkSlug,
      slug: String(r.slug || ''),
      name: String(r.name || ''),
      zoneId: r.zoneId ? String(r.zoneId) : null,
      zoneLabel: r.zoneLabel || null,
      masterProfile: r.masterProfile || {},
      typeCode: String(at).toUpperCase(),
      nslug: normalize(r.slug),
      nname: normalize(r.name),
    };
  });

  const bySlug = new Map(assets.map((a) => [a.slug, a]));

  const matched = [];
  const unmatched = [];
  const skippedNoZone = [];

  const applyRow = async (row, tx) => {
    const zoneSlug = ZONE_LABEL_TO_SLUG[row.zone];
    if (!zoneSlug) {
      unmatched.push({ name: row.name, reason: 'unknown_zone_label' });
      return;
    }

    const parkSlugs = row.zone === 'Rulantica' ? ['europa_park', 'rulantica'] : ['europa_park'];
    const candidates = [];
    if (Array.isArray(row.explicitSlugs) && row.explicitSlugs.length) {
      for (const s of row.explicitSlugs) {
        const a = bySlug.get(s);
        if (a && row.kind === a.typeCode) candidates.push(a);
      }
    }
    if (!candidates.length) {
      const aliases = (row.aliases || []).map(normalize).filter(Boolean);
      const pool = assets.filter((a) => parkSlugs.includes(a.parkSlug) && a.typeCode === row.kind);
      for (const a of pool) {
        if (aliases.some((al) => (al && (a.nslug.includes(al) || a.nname.includes(al))) || false)) {
          candidates.push(a);
          break;
        }
      }
    }

    if (!candidates.length) {
      unmatched.push({ name: row.name, zone: row.zone, kind: row.kind });
      return;
    }

    const found = candidates[0];
    const zoneId = zoneIdByParkAndSlug.get(found.parkSlug)?.get(zoneSlug) || null;
    if (!zoneId) {
      skippedNoZone.push({ name: row.name, park: found.parkSlug, zoneSlug });
      return;
    }

    const mergedProfile = {
      ...(found.masterProfile || {}),
      smartParkCategory: row.smartParkCategory,
      thematicZoneLabel: row.zone,
    };

    if (!DRY) {
      await ParkAsset.update(
        {
          zoneId,
          zoneLabel: row.zone,
          masterProfile: mergedProfile,
        },
        { where: { assetId: found.assetId }, ...(tx ? { transaction: tx } : {}) }
      );
    }

    matched.push({
      name: row.name,
      slug: found.slug,
      park: found.parkSlug,
      zone: row.zone,
      zoneId,
      smartParkCategory: row.smartParkCategory,
    });
  };

  if (!DRY) {
    await sequelize.transaction(async (tx) => {
      for (const row of ROWS) await applyRow(row, tx);
    });
  } else {
    for (const row of ROWS) await applyRow(row, null);
  }

  console.log(`[asset-zones] dryRun=${DRY} matched=${matched.length} unmatched=${unmatched.length} skippedNoZone=${skippedNoZone.length}`);
  for (const m of matched) {
    console.log(`  OK ${m.name} (${m.slug}) @ ${m.park} → ${m.zone} [${m.smartParkCategory}]`);
  }
  if (skippedNoZone.length) {
    console.log('[asset-zones] skipped (Ziel-Zone im Park nicht gefunden — MDM-Zonen migrieren?):');
    for (const s of skippedNoZone) console.log(`  - ${s.name} park=${s.park} zoneSlug=${s.zoneSlug}`);
  }
  if (unmatched.length) {
    console.log('[asset-zones] unmatched:');
    for (const u of unmatched) console.log('  -', u);
  }
}

main()
  .catch((e) => {
    console.error('[asset-zones] failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
