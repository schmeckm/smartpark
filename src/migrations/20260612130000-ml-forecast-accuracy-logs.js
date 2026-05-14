'use strict';

/** Forecast accuracy tracking — observational only; does not touch prediction engine. */

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ml_forecast_accuracy_logs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      prediction_id: { type: Sequelize.UUID, allowNull: true },
      park_id: { type: Sequelize.UUID, allowNull: true },
      ride_id: { type: Sequelize.UUID, allowNull: true },
      model_name: { type: Sequelize.STRING(160), allowNull: true },
      model_version: { type: Sequelize.STRING(160), allowNull: true },
      target_name: { type: Sequelize.STRING(160), allowNull: false },
      horizon_minutes: { type: Sequelize.INTEGER, allowNull: false },
      predicted_value: { type: Sequelize.DECIMAL(14, 6), allowNull: true },
      actual_value: { type: Sequelize.DECIMAL(14, 6), allowNull: true },
      absolute_error: { type: Sequelize.DECIMAL(14, 6), allowNull: true },
      percentage_error: { type: Sequelize.DECIMAL(14, 8), allowNull: true },
      squared_error: { type: Sequelize.DECIMAL(20, 10), allowNull: true },
      bias: { type: Sequelize.DECIMAL(14, 6), allowNull: true },
      accuracy_status: { type: Sequelize.STRING(16), allowNull: true },
      evaluated_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('ml_forecast_accuracy_logs', ['ride_id', 'evaluated_at'], {
      name: 'idx_ml_forecast_accuracy_logs_ride_evaluated_at',
    });
    await queryInterface.addIndex('ml_forecast_accuracy_logs', ['park_id', 'evaluated_at'], {
      name: 'idx_ml_forecast_accuracy_logs_park_evaluated_at',
    });
    await queryInterface.addIndex('ml_forecast_accuracy_logs', ['model_name', 'model_version'], {
      name: 'idx_ml_forecast_accuracy_logs_model',
    });
    await queryInterface.addIndex('ml_forecast_accuracy_logs', ['target_name'], {
      name: 'idx_ml_forecast_accuracy_logs_target_name',
    });
    await queryInterface.addIndex('ml_forecast_accuracy_logs', ['evaluated_at'], {
      name: 'idx_ml_forecast_accuracy_logs_evaluated_at',
    });
    await queryInterface.addIndex(
      'ml_forecast_accuracy_logs',
      ['prediction_id', 'horizon_minutes', 'target_name'],
      {
        unique: true,
        name: 'uq_ml_forecast_accuracy_logs_prediction_horizon_target',
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ml_forecast_accuracy_logs');
  },
};
