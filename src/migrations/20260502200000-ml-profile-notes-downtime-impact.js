'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ml_profiles', 'downtime_impact_level', {
      type: Sequelize.STRING(40),
      allowNull: true,
    });
    await queryInterface.addColumn('ml_profiles', 'notes', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ml_profiles', 'notes');
    await queryInterface.removeColumn('ml_profiles', 'downtime_impact_level');
  },
};
