'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('integration_flow_definitions', 'schedule_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('integration_flow_definitions', 'schedule_interval_seconds', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('integration_flow_definitions', 'last_scheduled_run_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('integration_flow_definitions', 'next_scheduled_run_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('integration_flow_definitions', 'schedule_lock_until', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addIndex('integration_flow_definitions', ['next_scheduled_run_at'], {
      name: 'idx_integration_flow_definitions_next_scheduled_run_at',
    });
    await queryInterface.addIndex('integration_flow_definitions', ['schedule_enabled'], {
      name: 'idx_integration_flow_definitions_schedule_enabled',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('integration_flow_definitions', 'idx_integration_flow_definitions_schedule_enabled');
    await queryInterface.removeIndex(
      'integration_flow_definitions',
      'idx_integration_flow_definitions_next_scheduled_run_at'
    );
    await queryInterface.removeColumn('integration_flow_definitions', 'schedule_lock_until');
    await queryInterface.removeColumn('integration_flow_definitions', 'next_scheduled_run_at');
    await queryInterface.removeColumn('integration_flow_definitions', 'last_scheduled_run_at');
    await queryInterface.removeColumn('integration_flow_definitions', 'schedule_interval_seconds');
    await queryInterface.removeColumn('integration_flow_definitions', 'schedule_enabled');
  },
};
