'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('parks', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      name: { type: Sequelize.STRING(120), allowNull: false },
      slug: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      timezone: { type: Sequelize.STRING(64), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.createTable('uns_nodes', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      park_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'parks', key: 'id' }, onDelete: 'CASCADE' },
      parent_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'uns_nodes', key: 'id' }, onDelete: 'SET NULL' },
      name: { type: Sequelize.STRING(120), allowNull: false },
      slug: { type: Sequelize.STRING(120), allowNull: false },
      node_type: {
        type: Sequelize.ENUM(
          'PARK',
          'DOMAIN',
          'AREA',
          'RIDE',
          'ENTRY',
          'PARKING',
          'TRAFFIC',
          'WEATHER',
          'FORECAST',
          'CAMERA',
          'SENSOR',
          'METRIC'
        ),
        allowNull: false,
      },
      domain: { type: Sequelize.STRING(80), allowNull: true },
      metric: { type: Sequelize.STRING(80), allowNull: true },
      unit: { type: Sequelize.STRING(32), allowNull: true },
      topic_path: { type: Sequelize.STRING(255), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      is_leaf: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.createTable('devices', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      park_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'parks', key: 'id' }, onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING(120), allowNull: false },
      device_type: {
        type: Sequelize.ENUM('CAMERA', 'SENSOR', 'API_ADAPTER', 'FORECAST_SERVICE', 'EDGE_NODE'),
        allowNull: false,
      },
      device_key: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      location_description: { type: Sequelize.STRING(255), allowNull: true },
      assigned_node_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'uns_nodes', key: 'id' }, onDelete: 'SET NULL' },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.createTable('canonical_events', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      park_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'parks', key: 'id' }, onDelete: 'CASCADE' },
      topic_path: { type: Sequelize.STRING(255), allowNull: false },
      event_type: { type: Sequelize.STRING(80), allowNull: false },
      event_time: { type: Sequelize.DATE, allowNull: false },
      source: { type: Sequelize.STRING(120), allowNull: true },
      quality: { type: Sequelize.STRING(16), allowNull: true },
      confidence: { type: Sequelize.FLOAT, allowNull: true },
      payload_json: { type: Sequelize.JSONB, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.createTable('latest_states', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      park_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'parks', key: 'id' }, onDelete: 'CASCADE' },
      topic_path: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      value: { type: Sequelize.JSONB, allowNull: false },
      event_time: { type: Sequelize.DATE, allowNull: false },
      source: { type: Sequelize.STRING(120), allowNull: true },
      quality: { type: Sequelize.STRING(16), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.createTable('forecast_snapshots', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      park_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'parks', key: 'id' }, onDelete: 'CASCADE' },
      snapshot_time: { type: Sequelize.DATE, allowNull: false },
      crowd_index: { type: Sequelize.FLOAT, allowNull: true },
      inbound_index: { type: Sequelize.FLOAT, allowNull: true },
      avg_queue_time: { type: Sequelize.FLOAT, allowNull: true },
      traffic_pressure_index: { type: Sequelize.FLOAT, allowNull: true },
      open_rides_count: { type: Sequelize.INTEGER, allowNull: true },
      closed_rides_count: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('forecast_snapshots');
    await queryInterface.dropTable('latest_states');
    await queryInterface.dropTable('canonical_events');
    await queryInterface.dropTable('devices');
    await queryInterface.dropTable('uns_nodes');
    await queryInterface.dropTable('parks');
  },
};
