'use strict';

/**
 * Seed MDM theme “district” zones for Europa Park (`mdm_parks.code = europa_park`).
 * Stores Typ / Attraktionen / operative Sicht in `zone_context` (JSONB).
 */

const ZONE_CODES = [
  'deutschland',
  'frankreich',
  'italien',
  'spanien',
  'griechenland',
  'island',
  'skandinavien',
  'oesterreich',
  'schweiz',
  'russland',
  'portugal',
  'irland',
  'luxemburg',
  'niederlande',
  'england',
  'kroatien',
  'abenteuerland',
  'grimms_maerchenwald',
  'welt_der_kinder',
  'rulantica',
];

const THEMENGEBIETE = [
  {
    code: 'deutschland',
    name: 'Deutschland',
    sortOrder: 100,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Eingang, historische Bereiche, Themenfahrten',
      operativeSmartParkSicht: 'Hohe Besucherströme / Main Entry',
    },
  },
  {
    code: 'frankreich',
    name: 'Frankreich',
    sortOrder: 110,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Silver Star, Moulin Rouge Stil',
      operativeSmartParkSicht: 'High-Throughput Rollercoaster Zone',
    },
  },
  {
    code: 'italien',
    name: 'Italien',
    sortOrder: 120,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Volo da Vinci',
      operativeSmartParkSicht: 'Familienbereich',
    },
  },
  {
    code: 'spanien',
    name: 'Spanien',
    sortOrder: 130,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Kolumbusjolle, Arena',
      operativeSmartParkSicht: 'Show- und Gastrobereich',
    },
  },
  {
    code: 'griechenland',
    name: 'Griechenland',
    sortOrder: 140,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Poseidon',
      operativeSmartParkSicht: 'Wasser-Attraktion / Peak Queue',
    },
  },
  {
    code: 'island',
    name: 'Island',
    sortOrder: 150,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'blue fire Megacoaster, Wodan',
      operativeSmartParkSicht: 'Extreme Ride Cluster',
    },
  },
  {
    code: 'skandinavien',
    name: 'Skandinavien',
    sortOrder: 160,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Fjord-Restaurant, Snorri',
      operativeSmartParkSicht: 'Family + Food Zone',
    },
  },
  {
    code: 'oesterreich',
    name: 'Österreich',
    sortOrder: 170,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Alpenexpress, Tirol-Flair',
      operativeSmartParkSicht: 'Familienverkehr',
    },
  },
  {
    code: 'schweiz',
    name: 'Schweiz',
    sortOrder: 180,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Matterhorn-Theming',
      operativeSmartParkSicht: 'Mid-Traffic Area',
    },
  },
  {
    code: 'russland',
    name: 'Russland',
    sortOrder: 190,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Euro-Mir',
      operativeSmartParkSicht: 'Hohe technische Komplexität',
    },
  },
  {
    code: 'portugal',
    name: 'Portugal',
    sortOrder: 200,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Atlantica SuperSplash',
      operativeSmartParkSicht: 'Wasser + Saisonabhängigkeit',
    },
  },
  {
    code: 'irland',
    name: 'Irland',
    sortOrder: 210,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Kinderwelt',
      operativeSmartParkSicht: 'Child / Family Analytics',
    },
  },
  {
    code: 'luxemburg',
    name: 'Luxemburg',
    sortOrder: 220,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Historische Themenfahrten',
      operativeSmartParkSicht: 'Low-throughput nostalgia area',
    },
  },
  {
    code: 'niederlande',
    name: 'Niederlande',
    sortOrder: 230,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Piraten in Batavia Umgebung',
      operativeSmartParkSicht: 'Indoor + Crowd Management',
    },
  },
  {
    code: 'england',
    name: 'England',
    sortOrder: 240,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Globe Theatre Stil',
      operativeSmartParkSicht: 'Show/Event Area',
    },
  },
  {
    code: 'kroatien',
    name: 'Kroatien',
    sortOrder: 250,
    zoneContext: {
      typ: 'Länderbereich',
      typischeAttraktionen: 'Voltron Nevera',
      operativeSmartParkSicht: 'Next-gen flagship coaster',
    },
  },
  {
    code: 'abenteuerland',
    name: 'Abenteuerland',
    sortOrder: 260,
    zoneContext: {
      typ: 'Spezialbereich',
      typischeAttraktionen: 'Dschungel / Abenteuer',
      operativeSmartParkSicht: 'Experience Zone',
    },
  },
  {
    code: 'grimms_maerchenwald',
    name: 'Grimms Märchenwald',
    sortOrder: 270,
    zoneContext: {
      typ: 'Spezialbereich',
      typischeAttraktionen: 'Märchenfahrten',
      operativeSmartParkSicht: 'Kinder-/Familienbereich',
    },
  },
  {
    code: 'welt_der_kinder',
    name: 'Welt der Kinder',
    sortOrder: 280,
    zoneContext: {
      typ: 'Spezialbereich',
      typischeAttraktionen: 'Kleine Attraktionen',
      operativeSmartParkSicht: 'Low-risk operational area',
    },
  },
  {
    code: 'rulantica',
    name: 'Rulantica',
    sortOrder: 290,
    zoneContext: {
      typ: 'Wasserwelt',
      typischeAttraktionen: 'Wasserpark',
      operativeSmartParkSicht: 'Separater Operational Cluster',
    },
  },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const table = 'mdm_park_zones';
    const desc = await qi.describeTable(table).catch(() => null);
    if (!desc) return;

    if (!desc.zone_context) {
      await qi.addColumn(table, 'zone_context', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      });
    }

    const [parks] = await qi.sequelize.query(`SELECT id FROM mdm_parks WHERE code = 'europa_park' LIMIT 1`);
    if (!parks?.length) return;

    const parkId = parks[0].id;

    for (const z of THEMENGEBIETE) {
      const ctx = JSON.stringify(z.zoneContext);
      await qi.sequelize.query(
        `INSERT INTO mdm_park_zones (id, park_id, code, name, sort_order, zone_context, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::varchar(64), $3::varchar(200), $4::int, $5::jsonb, NOW(), NOW())
         ON CONFLICT (park_id, code) DO NOTHING`,
        { bind: [parkId, z.code, z.name, z.sortOrder, ctx] }
      );
    }
  },

  async down(queryInterface, Sequelize) {
    const qi = queryInterface;
    const table = 'mdm_park_zones';
    const desc = await qi.describeTable(table).catch(() => null);
    if (!desc) return;

    const [parks] = await qi.sequelize.query(`SELECT id FROM mdm_parks WHERE code = 'europa_park' LIMIT 1`);
    if (parks?.length) {
      const parkId = parks[0].id;
      await qi.sequelize.query(
        `DELETE FROM mdm_park_zones WHERE park_id = $1::uuid AND code = ANY($2::text[])`,
        { bind: [parkId, ZONE_CODES] }
      );
    }

    if (desc.zone_context) {
      await qi.removeColumn(table, 'zone_context');
    }
  },
};
