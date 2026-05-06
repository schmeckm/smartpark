'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('canonical_inbound_messages', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      message_type: { type: Sequelize.STRING(80), allowNull: false },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      provider_message_id: { type: Sequelize.STRING(255), allowNull: true },
      external_destination_id: { type: Sequelize.STRING(255), allowNull: true },
      external_park_id: { type: Sequelize.STRING(255), allowNull: true },
      external_entity_id: { type: Sequelize.STRING(255), allowNull: true },
      entity_type: { type: Sequelize.STRING(80), allowNull: true },
      occurred_at: { type: Sequelize.DATE, allowNull: false },
      received_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      raw_payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'RECEIVED' },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('canonical_inbound_messages', ['provider', 'message_type', 'status'], {
      name: 'idx_canonical_msgs_provider_type_status',
    });
    await queryInterface.addIndex('canonical_inbound_messages', ['external_park_id', 'external_entity_id'], {
      name: 'idx_canonical_msgs_entity',
    });

    await queryInterface.createTable('provider_adapter_configs', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      provider: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(120), allowNull: false },
      base_url: { type: Sequelize.STRING(500), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      capabilities: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      auth_config: { type: Sequelize.JSONB, allowNull: true },
      rate_limit_config: { type: Sequelize.JSONB, allowNull: true },
      polling_config: { type: Sequelize.JSONB, allowNull: true },
      mapping_config: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('external_entity_mappings', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      external_destination_id: { type: Sequelize.STRING(255), allowNull: true },
      external_park_id: { type: Sequelize.STRING(255), allowNull: true },
      external_entity_id: { type: Sequelize.STRING(255), allowNull: false },
      external_entity_name: { type: Sequelize.STRING(255), allowNull: false },
      external_entity_type: { type: Sequelize.STRING(80), allowNull: false },
      internal_entity_type: { type: Sequelize.STRING(80), allowNull: true },
      internal_entity_id: { type: Sequelize.UUID, allowNull: true },
      mapping_status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'UNMAPPED' },
      confidence: { type: Sequelize.DECIMAL(8, 6), allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('external_entity_mappings', ['provider', 'external_park_id', 'external_entity_id'], {
      name: 'idx_ext_entity_mapping_unique',
      unique: true,
    });

    await queryInterface.createTable('mapping_rules', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      rule_name: { type: Sequelize.STRING(200), allowNull: false },
      external_entity_type: { type: Sequelize.STRING(80), allowNull: true },
      internal_entity_type: { type: Sequelize.STRING(80), allowNull: true },
      match_strategy: { type: Sequelize.STRING(32), allowNull: false },
      rule_config: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 100 },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('mapping_rules', ['provider', 'enabled', 'priority'], { name: 'idx_mapping_rules_provider' });

    await queryInterface.createTable('app_settings', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      key: { type: Sequelize.STRING(200), allowNull: false, unique: true },
      value: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('ride_wait_time_samples', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      external_park_id: { type: Sequelize.STRING(255), allowNull: false },
      external_entity_id: { type: Sequelize.STRING(255), allowNull: false },
      external_entity_name: { type: Sequelize.STRING(255), allowNull: true },
      internal_ride_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'rides', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      wait_time: { type: Sequelize.INTEGER, allowNull: true },
      status: { type: Sequelize.STRING(80), allowNull: true },
      is_open: { type: Sequelize.BOOLEAN, allowNull: true },
      raw_payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      sampled_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ride_wait_time_samples', ['provider', 'external_park_id', 'external_entity_id', 'sampled_at'], {
      name: 'idx_wait_time_samples_lookup',
    });

    await queryInterface.createTable('park_operating_snapshots', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      external_destination_id: { type: Sequelize.STRING(255), allowNull: true },
      external_park_id: { type: Sequelize.STRING(255), allowNull: false },
      opening_times: { type: Sequelize.JSONB, allowNull: true },
      crowd_level: { type: Sequelize.JSONB, allowNull: true },
      raw_payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      sampled_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('park_operating_snapshots', ['provider', 'external_park_id', 'sampled_at'], {
      name: 'idx_park_operating_snapshots_lookup',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('park_operating_snapshots');
    await queryInterface.dropTable('ride_wait_time_samples');
    await queryInterface.dropTable('app_settings');
    await queryInterface.dropTable('mapping_rules');
    await queryInterface.dropTable('external_entity_mappings');
    await queryInterface.dropTable('provider_adapter_configs');
    await queryInterface.dropTable('canonical_inbound_messages');
  },
};
