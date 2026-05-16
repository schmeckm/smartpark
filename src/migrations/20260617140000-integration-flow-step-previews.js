'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('integration_flow_run_steps', 'preview_input_json', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await queryInterface.addColumn('integration_flow_run_steps', 'preview_output_json', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('integration_flow_run_steps', 'preview_output_json');
    await queryInterface.removeColumn('integration_flow_run_steps', 'preview_input_json');
  },
};
