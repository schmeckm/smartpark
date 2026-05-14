'use strict';

/**
 * Seed demo traffic corridors for Europa Park (platform `parks` row).
 * Idempotent: skips when no matching park or rows already exist for this seed tag.
 */

module.exports = {
  async up(queryInterface) {
    const [parks] = await queryInterface.sequelize.query(
      `SELECT id FROM parks WHERE slug IN ('europa_park','europa-park') OR LOWER(name) LIKE '%europa park%' ORDER BY name LIMIT 1`
    );
    if (!parks.length) return;

    const parkId = parks[0].id;

    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM traffic_corridors WHERE park_id = :parkId AND description LIKE '%SEED_EUROPA_TRAFFIC_MVP%' LIMIT 1`,
      { replacements: { parkId } }
    );
    if (existing.length) return;

    const now = new Date();
    const rows = [
      {
        name: 'A5 Ausfahrt Rust → Besucherparkplatz',
        origin_label: 'A5 Ausfahrt Rust',
        destination_label: 'Besucherparkplatz',
        baseline_travel_time_min: 18,
      },
      {
        name: 'Ringsheim Bahnhof → Haupteingang',
        origin_label: 'Ringsheim Bahnhof',
        destination_label: 'Haupteingang',
        baseline_travel_time_min: 22,
      },
      {
        name: 'Freiburg → Europa-Park',
        origin_label: 'Freiburg',
        destination_label: 'Europa-Park',
        baseline_travel_time_min: 55,
      },
      {
        name: 'Offenburg → Europa-Park',
        origin_label: 'Offenburg',
        destination_label: 'Europa-Park',
        baseline_travel_time_min: 35,
      },
      {
        name: 'Rust Zentrum → Besucherparkplatz',
        origin_label: 'Rust Zentrum',
        destination_label: 'Besucherparkplatz',
        baseline_travel_time_min: 8,
      },
      {
        name: 'Hotel Resort → Haupteingang',
        origin_label: 'Hotel Resort',
        destination_label: 'Haupteingang',
        baseline_travel_time_min: 12,
      },
    ];

    await queryInterface.bulkInsert(
      'traffic_corridors',
      rows.map((r) => ({
        park_id: parkId,
        name: r.name,
        description: `SEED_EUROPA_TRAFFIC_MVP — ${r.origin_label} to ${r.destination_label}`,
        origin_label: r.origin_label,
        origin_lat: null,
        origin_lng: null,
        destination_label: r.destination_label,
        destination_lat: null,
        destination_lng: null,
        direction: 'inbound',
        source: 'manual',
        baseline_travel_time_min: r.baseline_travel_time_min,
        weight: 1.0,
        enabled: true,
        created_at: now,
        updated_at: now,
      }))
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM traffic_corridors WHERE description LIKE '%SEED_EUROPA_TRAFFIC_MVP%'`
    );
  },
};
