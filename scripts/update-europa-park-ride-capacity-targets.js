/* eslint-disable no-console */
'use strict';

require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { Op } = require('sequelize');
const { sequelize, Park, ParkAsset, RideMasterData } = require(path.join(__dirname, '..', 'src', 'models'));

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Kapazität / Typ / Kurztechnik — Referenztabelle Nutzer (ca. pph, Züge/Boote, Stichpunkte).
 * Unter `masterProfile.simulationProfile` (nur wenn gesetzt):
 * - `referenceTechnicalDe` — Bau-/Fahrphysik-Kurztext
 * - `operationalReferenceDe` — typische OT/Sparkplug-Metriken, SPS/Geräte, PdM-/AI-Usecases
 */
const CAPACITY_TARGETS = [
  {
    label: 'Silver Star',
    category: 'Hyper Coaster',
    manufacturer: 'Bolliger & Mabillard',
    buildYear: 2002,
    trainsCount: 3,
    seatsPerCycle: 36,
    pph: 1750,
    ticketCategory: 'E-Ticket',
    mlRideGroup: 'thrill_rides',
    referenceTechnicalDe: 'Höhe 73 m, max. 130 km/h, Länge ~1.620 m',
    operationalReferenceDe: {
      otSparkplugMetricsTypical:
        'Lift Motor Current, Brake Temperature, Train Position, Chain Speed, Wind Speed',
      typicalDevicesSps: 'Lift SPS, Brake Controller, VFD, Position Encoder',
      pdmAiUsecases: 'Motorverschleiß, Bremsen-Überhitzung, Kapazitätsverlust',
    },
    aliases: ['silver star', 'silver_star'],
  },
  {
    label: 'Voltron Nevera powered by Rimac',
    category: 'Multi-Launch Coaster',
    manufacturer: 'Mack Rides',
    buildYear: 2024,
    trainsCount: 7,
    seatsPerCycle: 16,
    pph: 1600,
    ticketCategory: 'E-Ticket',
    mlRideGroup: 'thrill_rides',
    referenceTechnicalDe: 'Multi-Launch, mehrere Inversionen',
    operationalReferenceDe: {
      otSparkplugMetricsTypical:
        'Launch Energy, Train Interval, PLC Status, Inversion Timing, Power Consumption',
      typicalDevicesSps: 'Launch PLC, Energy Meter, Safety PLC',
      pdmAiUsecases: 'Energie-Anomalien, Timing Drift',
    },
    aliases: ['voltron nevera powered by rimac', 'voltron nevera', 'voltron'],
    explicitSlugs: ['voltron_nevera_powered_by_rimac'],
  },
  {
    label: 'blue fire Megacoaster',
    category: 'Launch Coaster',
    manufacturer: 'Mack Rides',
    buildYear: 2009,
    trainsCount: 5,
    seatsPerCycle: 20,
    pph: 1720,
    referenceTechnicalDe: 'LSM-Launch, 100 km/h in 2,5 s',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Launch Current, LSM Status, Vibration, Throughput, Train Interval',
      typicalDevicesSps: 'LSM Controller, PLC, Vibration Sensor',
      pdmAiUsecases: 'Launch-System-Anomalien, Throughput-Optimierung',
    },
    aliases: ['blue fire megacoaster', 'blue fire', 'blue_fire'],
  },
  {
    label: 'WODAN - Timburcoaster',
    category: 'Wooden Coaster',
    manufacturer: 'GCI',
    buildYear: 2012,
    trainsCount: 3,
    seatsPerCycle: 24,
    pph: 1300,
    referenceTechnicalDe: 'Holzachterbahn, Länge ~1.050 m',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Wheel Temperature, Wooden Structure Sensors, Vibration, Axle Load',
      typicalDevicesSps: 'PLC, Bearing Sensors, Structural Sensors',
      pdmAiUsecases: 'Lagerausfall, Strukturüberwachung',
    },
    aliases: ['wodan timburcoaster', 'wodan'],
  },
  {
    label: 'Euro-Mir',
    category: 'Spinning Coaster',
    manufacturer: 'Mack Rides',
    buildYear: 1997,
    trainsCount: 9,
    seatsPerCycle: 16,
    pph: 1600,
    referenceTechnicalDe: 'Drehgondeln, Indoor/Outdoor',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Rotational Speed, Lift Status, Block Sections, Motor Current',
      typicalDevicesSps: 'Rotation Controller, Lift PLC',
      pdmAiUsecases: 'Rotationsfehler, Lift-Ausfall',
    },
    aliases: ['euro mir', 'euromir', 'euro-mir'],
  },
  {
    label: 'Eurosat - CanCan Coaster',
    category: 'Indoor Coaster',
    manufacturer: 'Mack Rides',
    buildYear: 1989,
    trainsCount: 7,
    seatsPerCycle: 16,
    pph: 1800,
    referenceTechnicalDe: 'Dunkelachterbahn im Kugelbau',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Indoor Climate, Train Position, Audio/Light Sync',
      typicalDevicesSps: 'Show Controller, Ride PLC',
      pdmAiUsecases: 'Indoor-Betriebsstabilität',
    },
    aliases: ['eurosat cancan coaster', 'eurosat', 'cancan coaster', 'eurosat_cancan_coaster'],
  },
  {
    label: 'Poseidon',
    category: 'Water Coaster',
    manufacturer: 'Mack Rides',
    buildYear: 2000,
    trainsCount: 8,
    seatsPerCycle: 20,
    pph: 1720,
    ticketCategory: 'D-Ticket',
    mlRideGroup: 'family_rides',
    referenceTechnicalDe: 'Kombination Wasserbahn + Achterbahn',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Water Pump Status, Boat Interval, Water Level, Pump Pressure',
      typicalDevicesSps: 'Pump PLC, Water Sensors',
      pdmAiUsecases: 'Pumpenausfall, Wasserstand-Probleme',
    },
    aliases: ['poseidon'],
  },
  {
    label: 'Atlantica SuperSplash',
    category: 'Water Ride',
    manufacturer: 'Mack Rides',
    buildYear: 2005,
    trainsCount: 8,
    seatsPerCycle: 20,
    pph: 1500,
    referenceTechnicalDe: 'Splash Ride mit Airtime-Hügel',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Pump Pressure, Boat Count, Splash Zone Sensors, Conveyor Speed',
      typicalDevicesSps: 'Pump Controller, Conveyor PLC',
      pdmAiUsecases: 'Förderbandverschleiß, Pumpenlast',
    },
    aliases: ['atlantica supersplash', 'atlantica_supersplash'],
  },
  { label: 'ARTHUR', category: 'Indoor/Inverted Family Coaster', manufacturer: 'Mack Rides', buildYear: 2014, trainsCount: 12, seatsPerCycle: 4, pph: 1600, ticketCategory: 'D-Ticket', mlRideGroup: 'family_rides', aliases: ['arthur'] },
  { label: 'Pegasus', category: 'Family Coaster', manufacturer: 'Mack Rides', buildYear: 2006, trainsCount: 5, seatsPerCycle: 20, pph: 1200, aliases: ['pegasus'] },
  {
    label: 'Matterhorn-Blitz',
    category: 'Wild Mouse Coaster',
    manufacturer: 'Mack Rides',
    buildYear: 1999,
    trainsCount: 8,
    seatsPerCycle: 4,
    pph: 1100,
    referenceTechnicalDe: 'Wilde Maus mit engen Kurven',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Brake Status, Car Count, Track Occupancy',
      typicalDevicesSps: 'Brake PLC, Position Sensors',
      pdmAiUsecases: 'Blockierungs-Erkennung',
    },
    aliases: ['matterhorn blitz', 'matterhorn_blitz'],
  },
  { label: 'Schweizer Bobbahn', category: 'Bobsled Coaster', manufacturer: 'Mack Rides', buildYear: 1985, trainsCount: 7, seatsPerCycle: 6, pph: 900, aliases: ['schweizer bobbahn', 'schweizer_bobbahn', 'swiss bob run', 'swiss_bob_run'] },
  { label: 'Voletarium', category: 'Flying Theater', manufacturer: 'Brogent', buildYear: 2017, trainsCount: 2, seatsPerCycle: 140, pph: 1400, aliases: ['voletarium'] },
  {
    label: 'Piraten in Batavia',
    category: 'Dark Ride',
    manufacturer: 'Mack Rides',
    buildYear: 1987,
    trainsCount: null,
    seatsPerCycle: 16,
    pph: 1600,
    referenceTechnicalDe: 'Medien-/Animatronic Ride',
    operationalReferenceDe: {
      otSparkplugMetricsTypical:
        'Boat Position, Show Scene Status, Animatronic Status, Audio Controller Status',
      typicalDevicesSps: 'Show PLC, DMX Controller, Boat Tracking',
      pdmAiUsecases: 'Show-Ausfälle, Szenenverfügbarkeit',
    },
    aliases: ['piraten in batavia', 'batavia', 'pirates_in_batavia'],
  },
  { label: 'Fjord Rafting', category: 'River Rafting', manufacturer: 'Intamin', buildYear: 1991, trainsCount: null, seatsPerCycle: 8, pph: 900, aliases: ['fjord rafting', 'fjord', 'fjord_rafting'] },
  {
    label: 'Snorri Touren',
    category: 'Dark Ride',
    manufacturer: null,
    buildYear: null,
    trainsCount: null,
    seatsPerCycle: 5,
    pph: 1200,
    operationClass: 'Family Capacity Ride',
    mlRideGroup: 'family_rides',
    weatherBufferRide: true,
    referenceTechnicalDe: 'Indoor Medienfahrt',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Vehicle Position, Media Sync, Ride Throughput',
      typicalDevicesSps: 'Media Controller, Vehicle PLC',
      pdmAiUsecases: 'Medien-Synchronisationsprobleme',
    },
    aliases: ['snorri touren', 'snorri'],
    explicitSlugs: ['snorri_touren'],
  },
  { label: 'Madame Freudenreich Curiosites', category: 'Indoor Ride', manufacturer: null, buildYear: null, trainsCount: null, seatsPerCycle: 4, pph: 850, aliases: ['madame freudenreich curiosites', 'madame freudenreich'] },
  { label: 'Jim Knopf - Reise durch Lummerland', category: 'Familien-Darkride', manufacturer: null, buildYear: null, trainsCount: null, seatsPerCycle: 20, pph: 1050, operationClass: 'Family Capacity Ride', mlRideGroup: 'family_rides', aliases: ['jim knopf', 'reise durch lummerland', 'jim button journey through morrowland', 'jim_button_journey_through_morrowland'] },
  { label: "Old Mac Donald's Tractor Fun", category: 'Track Ride', manufacturer: null, buildYear: null, trainsCount: null, seatsPerCycle: 3, pph: 750, aliases: ["old mac donald's tractor fun", 'tractor fun'] },
  {
    label: 'Ba-a-a Express',
    category: 'Kinderachterbahn',
    manufacturer: null,
    buildYear: null,
    trainsCount: 2,
    seatsPerCycle: 16,
    pph: 700,
    operationClass: 'Child Throughput Ride',
    mlRideGroup: 'family_rides',
    referenceTechnicalDe: 'Kinder-/Familienride',
    aliases: ['ba-a-a express', 'ba a a express', 'ba_a_a_express'],
  },
  {
    label: 'Dancing Dingie',
    category: 'Kinderattraktion',
    manufacturer: null,
    buildYear: null,
    trainsCount: null,
    seatsPerCycle: null,
    pph: 500,
    operationClass: 'Child Throughput Ride',
    mlRideGroup: 'family_rides',
    referenceTechnicalDe: 'Rundfahrgeschäft',
    aliases: ['dancing dingie', 'dancing dinghy', 'dancing_dinghy'],
  },
  { label: 'Kolumbusjolle', category: 'Schiffschaukel', manufacturer: null, buildYear: null, trainsCount: 1, seatsPerCycle: 40, pph: 500, aliases: ['kolumbusjolle', 'kolumbus'] },
  { label: 'Vindjammer', category: 'Schiffschaukel', manufacturer: null, buildYear: null, trainsCount: 1, seatsPerCycle: 40, pph: 500, aliases: ['vindjammer'] },
  {
    label: 'Tiroler Wildwasserbahn',
    category: 'Log Flume',
    manufacturer: null,
    buildYear: null,
    trainsCount: null,
    seatsPerCycle: 5,
    pph: 1100,
    referenceTechnicalDe: 'Klassische Wildwasserbahn',
    aliases: ['tiroler wildwasserbahn', 'wildwasserbahn', 'tirol log flume', 'tirol_log_flume'],
  },
  {
    label: 'Alpenexpress Enzian',
    category: 'Powered Coaster',
    manufacturer: null,
    buildYear: null,
    trainsCount: 4,
    seatsPerCycle: 20,
    pph: 1200,
    referenceTechnicalDe: 'Familienachterbahn',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Train Speed, Drive Current, Dispatch Interval',
      typicalDevicesSps: 'Drive Controller, Safety PLC',
      pdmAiUsecases: 'Dispatch-Optimierung',
    },
    aliases: ['alpenexpress enzian', 'alpenexpress_enzian', 'alpine express enzian', 'alpine_express_enzian'],
    explicitSlugs: ['alpenexpress_coastiality'],
  },
  {
    label: 'Volo da Vinci',
    category: 'Family Ride',
    manufacturer: null,
    buildYear: null,
    trainsCount: null,
    seatsPerCycle: 2,
    pph: 900,
    referenceTechnicalDe: 'Interaktive Fluggeräte',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Rotation Speed, Seat Status, Ride Cycle Time',
      typicalDevicesSps: 'Ride PLC, Motor Controller',
      pdmAiUsecases: 'Zykluszeit-Optimierung',
    },
    aliases: ['volo da vinci', 'volo_da_vinci'],
  },
  {
    label: 'Geisterschloss',
    category: 'Dark Ride',
    manufacturer: null,
    buildYear: null,
    trainsCount: null,
    seatsPerCycle: 4,
    pph: 1000,
    referenceTechnicalDe: 'Klassische Geisterbahn',
    aliases: ['geisterschloss', 'ghost castle', 'geisterschloss italy'],
  },
  { label: 'Dschungel-Flossfahrt', category: 'Bootsfahrt', manufacturer: null, buildYear: null, trainsCount: null, seatsPerCycle: 7, pph: 800, aliases: ['dschungel flossfahrt', 'dschungel-floßfahrt', 'dschungel_flossfahrt'] },
  { label: 'Wiener Wellenflieger', category: 'Kettenkarussell', manufacturer: null, buildYear: null, trainsCount: 1, seatsPerCycle: 40, pph: 650, aliases: ['wiener wellenflieger', 'wellenflieger', 'vienna wave swing', 'vienna_wave_swing_gl_ckspilz'] },
  { label: 'Safari-Tour', category: 'Rundfahrt', manufacturer: null, buildYear: null, trainsCount: null, seatsPerCycle: 4, pph: 750, aliases: ['safari tour', 'safari-tour'] },
  { label: 'Piccolo Mondo', category: 'Dark Ride', manufacturer: null, buildYear: null, trainsCount: null, seatsPerCycle: 3, pph: 850, operationClass: 'Crowd Distribution Ride', mlRideGroup: 'family_rides', aliases: ['piccolo mondo', 'piccolo_mondo'] },
  {
    label: 'Euro-Tower',
    category: 'Aussichtsturm',
    manufacturer: null,
    buildYear: null,
    trainsCount: 1,
    seatsPerCycle: null,
    pph: 800,
    referenceTechnicalDe: 'Langsame Vertikalfahrt',
    aliases: ['euro tower', 'euro-tower', 'euro_tower', 'eurotower'],
  },
  {
    label: 'Panoramabahn',
    category: 'Transport Ride',
    manufacturer: null,
    buildYear: null,
    trainsCount: null,
    seatsPerCycle: 80,
    pph: 2000,
    operationClass: 'Infrastructure Ride',
    mlRideGroup: 'infrastructure_rides',
    referenceTechnicalDe: 'Park-Transport-System',
    operationalReferenceDe: {
      otSparkplugMetricsTypical: 'Track Occupancy, Train GPS, Passenger Count, Station Dwell Time',
      typicalDevicesSps: 'GPS Tracker, Occupancy Sensors',
      pdmAiUsecases: 'Kapazitätssteuerung, Verkehrsfluss',
    },
    aliases: ['panoramabahn', 'panorama train'],
    explicitSlugs: ['panorama_train_station_germany', 'panorama_train_station_spain', 'panorama_train_station_russia', 'panorama_train_paddington_station'],
  },
  {
    label: 'Vinter Rytt',
    category: 'Wasserrutsche',
    manufacturer: null,
    buildYear: null,
    trainsCount: null,
    seatsPerCycle: null,
    pph: 900,
    referenceTechnicalDe: 'Reifenrutsche',
    aliases: ['vinter rytt', 'vinter_rytt', 'vinter ryt'],
  },
  { label: 'EP-Express', category: 'Monorail', manufacturer: null, buildYear: null, trainsCount: null, seatsPerCycle: 120, pph: 3200, operationClass: 'Infrastructure Ride', mlRideGroup: 'infrastructure_rides', aliases: ['ep-express', 'ep express', 'ep_express'], explicitSlugs: ['ep_express_station_alexanderplatz', 'ep_express_station_greece', 'ep_express_station_hotels', 'ep_express_station_spain'] },
];

async function main() {
  const dryRun = !process.argv.includes('--apply');
  const parkSlug = 'europa_park';
  const park = await Park.findOne({ where: { slug: parkSlug } });
  if (!park) throw new Error(`Park not found: ${parkSlug}`);
  const parkRulantica = await Park.findOne({ where: { slug: 'rulantica' } });
  const parkIds = [park.id];
  if (parkRulantica) parkIds.push(parkRulantica.id);

  const rows = await ParkAsset.findAll({
    where: { parkId: { [Op.in]: parkIds } },
    attributes: ['assetId', 'slug', 'name', 'masterProfile'],
  });

  const assets = rows.map((r) => ({
    assetId: String(r.assetId),
    slug: String(r.slug || ''),
    name: String(r.name || ''),
    masterProfile: r.masterProfile || {},
    nslug: normalize(r.slug),
    nname: normalize(r.name),
  }));

  let updated = 0;
  const unmatched = [];
  const matched = [];
  const bySlug = new Map(assets.map((a) => [a.slug, a]));

  if (!dryRun) await sequelize.transaction(async (tx) => {
    for (const t of CAPACITY_TARGETS) {
      const aliases = t.aliases.map(normalize);
      const foundList = Array.isArray(t.explicitSlugs) && t.explicitSlugs.length
        ? t.explicitSlugs.map((s) => bySlug.get(s)).filter(Boolean)
        : assets.filter((a) => aliases.some((alias) => a.nslug.includes(alias) || a.nname.includes(alias))).slice(0, 1);
      if (!foundList.length) {
        unmatched.push(t.label);
        continue;
      }
      for (const found of foundList) {
        const rmdPayload = {
          assetId: found.assetId,
          rideCategory: t.category,
          manufacturer: t.manufacturer,
          buildYear: t.buildYear,
          trainsCount: t.trainsCount,
          capacityPph: t.pph,
          theoreticalCapacityPph: t.pph,
        };
        if (t.seatsPerCycle != null) rmdPayload.seatsPerCycle = t.seatsPerCycle;
        await RideMasterData.upsert(rmdPayload, { transaction: tx });
        const mergedProfile = {
          ...(found.masterProfile || {}),
          simulationProfile: {
            ticketCategory: t.ticketCategory || null,
            operationClass: t.operationClass || null,
            mlRideGroup: t.mlRideGroup || null,
            weatherBufferRide: Boolean(t.weatherBufferRide),
            indoorDemandFactorHint: t.weatherBufferRide
              ? 'indoor demand likely increases with rain/cold and crowd pressure'
              : null,
            ...(t.referenceTechnicalDe ? { referenceTechnicalDe: t.referenceTechnicalDe } : {}),
            ...(t.operationalReferenceDe ? { operationalReferenceDe: t.operationalReferenceDe } : {}),
          },
        };
        await ParkAsset.update(
          { masterProfile: mergedProfile },
          { where: { assetId: found.assetId }, transaction: tx }
        );
        matched.push({ label: t.label, slug: found.slug, category: t.category, pph: t.pph, manufacturer: t.manufacturer });
        updated += 1;
      }
    }
  });
  if (dryRun) {
    for (const t of CAPACITY_TARGETS) {
      const aliases = t.aliases.map(normalize);
      const foundList = Array.isArray(t.explicitSlugs) && t.explicitSlugs.length
        ? t.explicitSlugs.map((s) => bySlug.get(s)).filter(Boolean)
        : assets.filter((a) => aliases.some((alias) => a.nslug.includes(alias) || a.nname.includes(alias))).slice(0, 1);
      if (!foundList.length) unmatched.push(t.label);
      else for (const found of foundList) matched.push({ label: t.label, slug: found.slug, category: t.category, pph: t.pph, manufacturer: t.manufacturer });
    }
  }

  const parkNote = parkRulantica ? `${parkSlug}+rulantica` : parkSlug;
  console.log(`[capacity-targets] park=${parkNote} dryRun=${dryRun} matched=${matched.length} updated=${updated}`);
  for (const m of matched) console.log(`  - ${m.label} -> ${m.slug} = ${m.pph} pph [${m.category}] (${m.manufacturer})`);
  if (unmatched.length) {
    console.log('[capacity-targets] unmatched entries:');
    for (const u of unmatched) console.log(`  - ${u}`);
  }
}

main()
  .catch((err) => {
    console.error('[capacity-targets] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });

