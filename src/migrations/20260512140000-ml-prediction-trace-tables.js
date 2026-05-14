'use strict';

/** Phase 1 ML — additive prediction trace (observability only; gated by ML_TRACE_ENABLED). */

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ml_prediction_traces', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      prediction_id: { type: Sequelize.UUID, allowNull: false },
      park_id: { type: Sequelize.UUID, allowNull: true },
      ride_id: { type: Sequelize.UUID, allowNull: true },
      model_name: { type: Sequelize.STRING(160), allowNull: false },
      model_version: { type: Sequelize.STRING(160), allowNull: true },
      target_name: { type: Sequelize.STRING(160), allowNull: false },
      horizon_minutes: { type: Sequelize.INTEGER, allowNull: true },
      feature_vector_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      feature_sources_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      feature_status_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      missing_features_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      fallback_used: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      prediction_input_hash: { type: Sequelize.STRING(128), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('ml_prediction_results', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      prediction_id: { type: Sequelize.UUID, allowNull: false },
      park_id: { type: Sequelize.UUID, allowNull: true },
      ride_id: { type: Sequelize.UUID, allowNull: true },
      model_name: { type: Sequelize.STRING(160), allowNull: false },
      model_version: { type: Sequelize.STRING(160), allowNull: true },
      target_name: { type: Sequelize.STRING(160), allowNull: false },
      horizon_minutes: { type: Sequelize.INTEGER, allowNull: true },
      predicted_value: { type: Sequelize.DECIMAL(12, 4), allowNull: true },
      actual_value: { type: Sequelize.DECIMAL(12, 4), allowNull: true },
      confidence_score: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
      reason_codes_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      fallback_used: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    for (const table of ['ml_prediction_traces', 'ml_prediction_results']) {
      await queryInterface.addIndex(table, ['prediction_id'], { name: `idx_${table}_prediction_id` });
      await queryInterface.addIndex(table, ['ride_id', 'created_at'], { name: `idx_${table}_ride_created` });
      await queryInterface.addIndex(table, ['park_id', 'created_at'], { name: `idx_${table}_park_created` });
      await queryInterface.addIndex(table, ['model_name', 'model_version'], { name: `idx_${table}_model` });
      await queryInterface.addIndex(table, ['target_name'], { name: `idx_${table}_target` });
      await queryInterface.addIndex(table, ['created_at'], { name: `idx_${table}_created_at` });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ml_prediction_results');
    await queryInterface.dropTable('ml_prediction_traces');
  },
};
