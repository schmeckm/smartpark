'use strict';

/**
 * Optional demo rows: inbound corridors for an existing Europa Park row in `parks`.
 * Skips when no matching park; idempotent via `source = 'europa_demo_seed'`.
 */

const CORRIDOR_A = 'f0000001-0000-4000-8000-0000000000a1';
const CORRIDOR_B = 'f0000001-0000-4000-8000-0000000000b2';
const SOURCE = 'europa_demo_seed';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;
    const now = new Date();

    const [parkRows] = await sequelize.query(
      `SELECT id FROM parks
       WHERE slug IN ('europa-park', 'europa_park', 'europapark')
          OR LOWER(TRIM(name)) IN ('europa park', 'europa-park')
       LIMIT 1`
    );
    const parkId = parkRows && parkRows[0] && parkRows[0].id;
    if (!parkId) return;

    const [existing] = await sequelize.query(
      `SELECT id FROM traffic_corridors WHERE park_id = :parkId AND source = :source LIMIT 1`,
      { replacements: { parkId, source: SOURCE } }
    );
    if (existing && existing.length) return;

    await queryInterface.bulkInsert('traffic_corridors', [
      {
        id: CORRIDOR_A,
        park_id: parkId,
        name: 'A5 → Haupteingang (Demo)',
        description: 'Example inbound corridor toward main entrance (illustrative coordinates).',
        origin_label: 'A5 / Rust',
        origin_lat: 48.3312,
        origin_lng: 7.7214,
        destination_label: 'Europa-Park Haupteingang',
        destination_lat: 48.2669,
        destination_lng: 7.719,
        direction: 'inbound',
        source: SOURCE,
        baseline_travel_time_min: 22,
        weight: 1.2,
        enabled: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: CORRIDOR_B,
        park_id: parkId,
        name: 'B500 → Parkzufahrt (Demo)',
        description: 'Second example corridor for weighted traffic pressure.',
        origin_label: 'B500 approach',
        origin_lat: 48.305,
        origin_lng: 7.75,
        destination_label: 'Park access ring',
        destination_lat: 48.27,
        destination_lng: 7.72,
        direction: 'inbound',
        source: SOURCE,
        baseline_travel_time_min: 18,
        weight: 1.0,
        enabled: true,
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DELETE FROM traffic_corridors WHERE source = :source`, {
      replacements: { source: SOURCE },
    });
  },
};
