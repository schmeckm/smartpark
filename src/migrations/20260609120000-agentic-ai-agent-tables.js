'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('agent_runs', {
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
      skill_id: { type: Sequelize.STRING(64), allowNull: false },
      trigger_type: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'manual' },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'running' },
      started_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      input_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      output_summary: { type: Sequelize.TEXT, allowNull: true },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      meta_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('agent_runs', ['park_id', 'started_at'], {
      name: 'agent_runs_park_id_started_at_idx',
    });
    await queryInterface.addIndex('agent_runs', ['skill_id', 'status', 'started_at'], {
      name: 'agent_runs_skill_id_status_started_at_idx',
    });

    await queryInterface.createTable('agent_steps', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      run_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'agent_runs', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      step_index: { type: Sequelize.INTEGER, allowNull: false },
      step_type: { type: Sequelize.STRING(24), allowNull: false },
      title: { type: Sequelize.STRING(240), allowNull: true },
      detail_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('agent_steps', ['run_id', 'step_index'], {
      name: 'agent_steps_run_id_step_index_idx',
      unique: true,
    });

    await queryInterface.createTable('agent_actions', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      run_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'agent_runs', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      step_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'agent_steps', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      action_type: { type: Sequelize.STRING(64), allowNull: false },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'pending' },
      payload_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      result_json: { type: Sequelize.JSONB, allowNull: true },
      expires_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('agent_actions', ['status', 'expires_at'], {
      name: 'agent_actions_status_expires_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('agent_actions');
    await queryInterface.dropTable('agent_steps');
    await queryInterface.dropTable('agent_runs');
  },
};
