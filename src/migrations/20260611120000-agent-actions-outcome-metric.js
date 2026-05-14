'use strict';

/** Phase C — outcome tracking on agent_actions (forecast-vs-actual bridge stub + reject metadata). */

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('agent_actions', 'outcome_metric', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('agent_actions', 'outcome_metric');
  },
};
