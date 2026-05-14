'use strict';

/** Attendance risk MVP: manual traffic corridors, 5m snapshots, park demand forecasts. */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('traffic_corridors', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING(200), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      origin_label: { type: Sequelize.STRING(300), allowNull: true },
      origin_lat: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      origin_lng: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      destination_label: { type: Sequelize.STRING(300), allowNull: true },
      destination_lat: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      destination_lng: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      direction: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: 'inbound',
      },
      source: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'manual' },
      baseline_travel_time_min: { type: Sequelize.DECIMAL(12, 4), allowNull: false },
      weight: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 1.0 },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('traffic_corridors', ['park_id'], { name: 'traffic_corridors_park_id_idx' });

    await queryInterface.createTable('traffic_corridor_snapshots_5m', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      corridor_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'traffic_corridors', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      snapshot_ts: { type: Sequelize.DATE, allowNull: false },
      source: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'manual' },
      current_travel_time_min: { type: Sequelize.DECIMAL(12, 4), allowNull: false },
      baseline_travel_time_min: { type: Sequelize.DECIMAL(12, 4), allowNull: false },
      delay_min: { type: Sequelize.DECIMAL(12, 4), allowNull: true },
      delay_percent: { type: Sequelize.DECIMAL(14, 8), allowNull: true },
      congestion_score: { type: Sequelize.DECIMAL(12, 4), allowNull: true },
      inbound_pressure_score: { type: Sequelize.DECIMAL(12, 4), allowNull: true },
      raw_payload_json: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('traffic_corridor_snapshots_5m', ['park_id', 'snapshot_ts'], {
      name: 'tcs5m_park_snapshot_ts_idx',
    });
    await queryInterface.addIndex('traffic_corridor_snapshots_5m', ['corridor_id', 'snapshot_ts'], {
      name: 'tcs5m_corridor_snapshot_ts_idx',
    });

    await queryInterface.createTable('park_demand_forecasts_5m', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      snapshot_ts: { type: Sequelize.DATE, allowNull: false },
      planned_demand: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      known_registered_expected: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      planned_total: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      traffic_pressure_score: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      weather_score: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      holiday_score: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      event_score: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      parking_pressure_score: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      external_demand_pressure_score: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      additional_demand_low: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      additional_demand_mid: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      additional_demand_high: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      expected_attendance_low: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      expected_attendance_mid: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      expected_attendance_high: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: 'normal',
      },
      confidence_score: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
      recommendations_json: { type: Sequelize.JSONB, allowNull: true },
      explanation_json: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('park_demand_forecasts_5m', ['park_id', 'snapshot_ts'], {
      name: 'pdf5m_park_snapshot_ts_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('park_demand_forecasts_5m');
    await queryInterface.dropTable('traffic_corridor_snapshots_5m');
    await queryInterface.dropTable('traffic_corridors');
  },
};
