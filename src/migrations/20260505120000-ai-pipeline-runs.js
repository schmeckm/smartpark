'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ai_pipeline_runs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      started_at: { type: Sequelize.DATE, allowNull: false },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      duration_ms: { type: Sequelize.INTEGER, allowNull: true },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'running' },
      park_snapshots_written: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ride_snapshots_written: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      labels_written: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      feature_store_error: { type: Sequelize.TEXT, allowNull: true },
      scoring_error: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ai_pipeline_runs', ['finished_at'], {
      name: 'idx_ai_pipeline_runs_finished_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_pipeline_runs');
  },
};
