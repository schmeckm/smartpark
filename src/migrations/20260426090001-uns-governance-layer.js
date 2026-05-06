'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('uns_nodes', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      park_id: { type: Sequelize.STRING(255), allowNull: false },
      parent_id: { type: Sequelize.UUID, allowNull: true },
      name: { type: Sequelize.STRING(200), allowNull: false },
      slug: { type: Sequelize.STRING(200), allowNull: false },
      node_type: { type: Sequelize.STRING(80), allowNull: false },
      domain: { type: Sequelize.STRING(80), allowNull: true },
      metric: { type: Sequelize.STRING(80), allowNull: true },
      topic_path: { type: Sequelize.STRING(500), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      is_leaf: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('uns_nodes', ['park_id', 'parent_id'], { name: 'idx_uns_nodes_park_parent' });
    await queryInterface.addIndex('uns_nodes', ['park_id', 'topic_path'], { name: 'idx_uns_nodes_park_topic' });

    await queryInterface.createTable('uns_latest_states', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      park_id: { type: Sequelize.STRING(255), allowNull: false },
      topic_path: { type: Sequelize.STRING(500), allowNull: false, unique: true },
      payload_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      event_time: { type: Sequelize.DATE, allowNull: false },
      quality: { type: Sequelize.STRING(32), allowNull: true },
      source: { type: Sequelize.STRING(80), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('uns_latest_states', ['park_id', 'event_time'], { name: 'idx_uns_latest_park_event_time' });

    await queryInterface.createTable('uns_devices', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      park_id: { type: Sequelize.STRING(255), allowNull: false },
      name: { type: Sequelize.STRING(200), allowNull: false },
      device_type: { type: Sequelize.STRING(80), allowNull: false },
      device_key: { type: Sequelize.STRING(200), allowNull: false, unique: true },
      assigned_node_id: { type: Sequelize.UUID, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('uns_devices', ['park_id', 'is_active'], { name: 'idx_uns_devices_park_active' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('uns_devices');
    await queryInterface.dropTable('uns_latest_states');
    await queryInterface.dropTable('uns_nodes');
  },
};
