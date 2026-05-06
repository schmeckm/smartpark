'use strict';

/** Wait-time prediction model registry (Node.js Phase 2 ML layer). */

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ml_model_registry', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      model_id: { type: Sequelize.STRING(160), allowNull: false },
      model_type: { type: Sequelize.STRING(64), allowNull: false },
      scope_type: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'global' },
      scope_id: { type: Sequelize.STRING(255), allowNull: true },
      target: { type: Sequelize.STRING(64), allowNull: false },
      horizon_minutes: { type: Sequelize.INTEGER, allowNull: false },
      feature_list: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      model_payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metrics: { type: Sequelize.JSONB, allowNull: true },
      training_rows: { type: Sequelize.INTEGER, allowNull: true },
      trained_at: { type: Sequelize.DATE, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ml_model_registry', ['model_type', 'horizon_minutes', 'is_active'], {
      name: 'idx_ml_model_registry_type_horizon_active',
    });
    await queryInterface.addIndex('ml_model_registry', ['scope_type', 'scope_id', 'horizon_minutes', 'is_active'], {
      name: 'idx_ml_model_registry_scope_horizon_active',
    });
    await queryInterface.addIndex('ml_model_registry', ['model_id'], {
      name: 'idx_ml_model_registry_model_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ml_model_registry');
  },
};
