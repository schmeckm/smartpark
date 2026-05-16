'use strict';

/** Chosen FEATURE_STORE / wait-time algorithm persisted on the ride asset (forecast behaviour). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('park_assets', 'evaluated_algorithm', {
      type: Sequelize.STRING(48),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('park_assets', 'evaluated_algorithm');
  },
};
