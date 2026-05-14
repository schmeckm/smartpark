'use strict';

/** Phase 4 — manual feature weights on ML profiles + weighted X vector on prediction traces (observability). */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ml_park_profiles', 'feature_weights_json', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await queryInterface.addColumn('ml_ride_profiles', 'feature_weights_json', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await queryInterface.addColumn('ml_prediction_traces', 'weighted_feature_vector_json', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ml_prediction_traces', 'weighted_feature_vector_json');
    await queryInterface.removeColumn('ml_ride_profiles', 'feature_weights_json');
    await queryInterface.removeColumn('ml_park_profiles', 'feature_weights_json');
  },
};
