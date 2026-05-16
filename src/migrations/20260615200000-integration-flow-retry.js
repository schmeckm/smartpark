'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('integration_flow_definitions', 'retry_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('integration_flow_definitions', 'max_retry_attempts', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('integration_flow_definitions', 'retry_delay_seconds', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('integration_flow_definitions', 'retry_on_node_types', {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    await queryInterface.addColumn('integration_flow_runs', 'parent_run_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'integration_flow_runs', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('integration_flow_runs', 'retry_attempt', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('integration_flow_runs', 'retry_of_run_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'integration_flow_runs', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('integration_flow_runs', 'next_retry_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('integration_flow_runs', 'retry_status', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await queryInterface.addColumn('integration_flow_runs', 'retry_lock_until', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addIndex('integration_flow_runs', ['retry_status', 'next_retry_at'], {
      name: 'idx_integration_flow_runs_retry_pending',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('integration_flow_runs', 'idx_integration_flow_runs_retry_pending');
    await queryInterface.removeColumn('integration_flow_runs', 'retry_lock_until');
    await queryInterface.removeColumn('integration_flow_runs', 'retry_status');
    await queryInterface.removeColumn('integration_flow_runs', 'next_retry_at');
    await queryInterface.removeColumn('integration_flow_runs', 'retry_of_run_id');
    await queryInterface.removeColumn('integration_flow_runs', 'retry_attempt');
    await queryInterface.removeColumn('integration_flow_runs', 'parent_run_id');
    await queryInterface.removeColumn('integration_flow_definitions', 'retry_on_node_types');
    await queryInterface.removeColumn('integration_flow_definitions', 'retry_delay_seconds');
    await queryInterface.removeColumn('integration_flow_definitions', 'max_retry_attempts');
    await queryInterface.removeColumn('integration_flow_definitions', 'retry_enabled');
  },
};
