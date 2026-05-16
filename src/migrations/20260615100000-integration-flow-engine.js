'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('integration_flow_definitions', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      name: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      trigger_type: {
        type: Sequelize.STRING(64),
        allowNull: false,
        defaultValue: 'MANUAL',
      },
      flow_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_by: { type: Sequelize.STRING(255), allowNull: true },
      updated_by: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('integration_flow_definitions', ['park_id'], {
      name: 'idx_integration_flow_definitions_park_id',
    });
    await queryInterface.addIndex('integration_flow_definitions', ['enabled'], {
      name: 'idx_integration_flow_definitions_enabled',
    });

    await queryInterface.createTable('integration_flow_runs', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      flow_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'integration_flow_definitions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: { type: Sequelize.STRING(32), allowNull: false },
      started_at: { type: Sequelize.DATE, allowNull: true },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      duration_ms: { type: Sequelize.INTEGER, allowNull: true },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      input_json: { type: Sequelize.JSONB, allowNull: true },
      output_json: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('integration_flow_runs', ['flow_id'], {
      name: 'idx_integration_flow_runs_flow_id',
    });
    await queryInterface.addIndex('integration_flow_runs', ['status'], {
      name: 'idx_integration_flow_runs_status',
    });
    await queryInterface.addIndex('integration_flow_runs', ['created_at'], {
      name: 'idx_integration_flow_runs_created_at',
    });

    await queryInterface.createTable('integration_flow_run_steps', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      run_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_flow_runs', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      node_id: { type: Sequelize.STRING(128), allowNull: false },
      node_type: { type: Sequelize.STRING(80), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false },
      started_at: { type: Sequelize.DATE, allowNull: true },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      duration_ms: { type: Sequelize.INTEGER, allowNull: true },
      input_json: { type: Sequelize.JSONB, allowNull: true },
      output_json: { type: Sequelize.JSONB, allowNull: true },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('integration_flow_run_steps', ['run_id'], {
      name: 'idx_integration_flow_run_steps_run_id',
    });

    await queryInterface.createTable('integration_node_registry', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      node_key: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      node_type: { type: Sequelize.STRING(64), allowNull: false },
      display_name: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.STRING(128), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      config_schema: { type: Sequelize.JSONB, allowNull: true },
      input_schema: { type: Sequelize.JSONB, allowNull: true },
      output_schema: { type: Sequelize.JSONB, allowNull: true },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('integration_node_registry', ['enabled'], {
      name: 'idx_integration_node_registry_enabled',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('integration_flow_run_steps');
    await queryInterface.dropTable('integration_flow_runs');
    await queryInterface.dropTable('integration_node_registry');
    await queryInterface.dropTable('integration_flow_definitions');
  },
};
