'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ai_studio_models', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      model_scope: { type: Sequelize.STRING(16), allowNull: false },
      entity_type: { type: Sequelize.STRING(32), allowNull: false },
      entity_id: { type: Sequelize.UUID, allowNull: true },
      target_variable: { type: Sequelize.STRING(64), allowNull: false },
      features_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      strategy: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'MANUAL' },
      algorithm: { type: Sequelize.STRING(48), allowNull: false },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      mae: { type: Sequelize.DOUBLE, allowNull: true },
      rmse: { type: Sequelize.DOUBLE, allowNull: true },
      r2: { type: Sequelize.DOUBLE, allowNull: true },
      last_training_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      active_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      model_payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      feature_importance_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      eval_holdout_json: { type: Sequelize.JSONB, allowNull: true },
      dataset_snapshot_json: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('ai_studio_models', ['park_id', 'entity_type', 'target_variable', 'active_flag'], {
      name: 'idx_ai_studio_models_park_entity_target_active',
    });
    await queryInterface.addIndex('ai_studio_models', ['park_id', 'model_scope', 'entity_type', 'entity_id'], {
      name: 'idx_ai_studio_models_scope_entity',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_studio_models');
  },
};
