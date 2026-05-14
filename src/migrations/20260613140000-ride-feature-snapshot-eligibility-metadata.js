'use strict';

/** @type {import('sequelize').QueryInterface} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ride_feature_snapshots_5m', 'park_is_open', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });
    await queryInterface.addColumn('ride_feature_snapshots_5m', 'ride_is_open', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });
    await queryInterface.addColumn('ride_feature_snapshots_5m', 'forecast_eligible', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn('ride_feature_snapshots_5m', 'training_eligible', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn('ride_feature_snapshots_5m', 'accuracy_eligible', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn('ride_feature_snapshots_5m', 'data_quality_reason', {
      type: Sequelize.STRING(160),
      allowNull: true,
    });

    await queryInterface.addColumn('ml_prediction_traces', 'governed_snapshot_quality_reason', {
      type: Sequelize.STRING(80),
      allowNull: true,
    });

    await queryInterface.addColumn('ml_forecast_accuracy_logs', 'evaluation_reason', {
      type: Sequelize.STRING(80),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ride_feature_snapshots_5m', 'park_is_open');
    await queryInterface.removeColumn('ride_feature_snapshots_5m', 'ride_is_open');
    await queryInterface.removeColumn('ride_feature_snapshots_5m', 'forecast_eligible');
    await queryInterface.removeColumn('ride_feature_snapshots_5m', 'training_eligible');
    await queryInterface.removeColumn('ride_feature_snapshots_5m', 'accuracy_eligible');
    await queryInterface.removeColumn('ride_feature_snapshots_5m', 'data_quality_reason');
    await queryInterface.removeColumn('ml_prediction_traces', 'governed_snapshot_quality_reason');
    await queryInterface.removeColumn('ml_forecast_accuracy_logs', 'evaluation_reason');
  },
};
