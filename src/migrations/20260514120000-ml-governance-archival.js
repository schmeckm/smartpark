'use strict';

/** Soft-delete / archival for AI Studio models, ML registry rows, and ML metadata profiles. */

module.exports = {
  async up(queryInterface, Sequelize) {
    const addArchival = async (table) => {
      await queryInterface.addColumn(table, 'archived_at', {
        type: Sequelize.DATE,
        allowNull: true,
        field: 'archived_at',
      });
      await queryInterface.addColumn(table, 'archived_by', {
        type: Sequelize.UUID,
        allowNull: true,
        field: 'archived_by',
      });
    };

    await addArchival('ml_model_registry');
    await addArchival('ml_park_profiles');
    await addArchival('ml_ride_profiles');
  },

  async down(queryInterface) {
    for (const table of ['ml_ride_profiles', 'ml_park_profiles', 'ml_model_registry']) {
      await queryInterface.removeColumn(table, 'archived_by');
      await queryInterface.removeColumn(table, 'archived_at');
    }
  },
};
