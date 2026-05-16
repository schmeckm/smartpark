'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('integration_flow_runs', 'acknowledged_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('integration_flow_runs', 'acknowledged_by', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn('integration_flow_runs', 'acknowledgement_note', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addIndex('integration_flow_runs', ['status', 'finished_at'], {
      name: 'idx_integration_flow_runs_failure_inbox',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('integration_flow_runs', 'idx_integration_flow_runs_failure_inbox');
    await queryInterface.removeColumn('integration_flow_runs', 'acknowledgement_note');
    await queryInterface.removeColumn('integration_flow_runs', 'acknowledged_by');
    await queryInterface.removeColumn('integration_flow_runs', 'acknowledged_at');
  },
};
