'use strict';

/** Park-scoped AI: zones.park_id, pipeline runs + batch jobs, indexes. */

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('zones', 'park_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'parks', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('zones', ['park_id'], { name: 'idx_zones_park_id' });

    await queryInterface.addColumn('ai_pipeline_runs', 'park_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'parks', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('ai_pipeline_runs', ['park_id', 'started_at'], {
      name: 'idx_ai_pipeline_runs_park_started',
    });

    await queryInterface.createTable('ai_studio_batch_jobs', {
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
      batch_id: { type: Sequelize.UUID, allowNull: false },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'running' },
      total: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      current: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      current_entity_id: { type: Sequelize.STRING(64), allowNull: true },
      current_entity_label: { type: Sequelize.STRING(160), allowNull: true },
      results_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      error: { type: Sequelize.TEXT, allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: false },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ai_studio_batch_jobs', ['park_id', 'started_at'], {
      name: 'idx_ai_studio_batch_jobs_park_started',
    });
    await queryInterface.addIndex('ai_studio_batch_jobs', ['park_id', 'batch_id'], {
      unique: true,
      name: 'uq_ai_studio_batch_jobs_park_batch',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_studio_batch_jobs');
    await queryInterface.removeIndex('ai_pipeline_runs', 'idx_ai_pipeline_runs_park_started');
    await queryInterface.removeColumn('ai_pipeline_runs', 'park_id');
    await queryInterface.removeIndex('zones', 'idx_zones_park_id');
    await queryInterface.removeColumn('zones', 'park_id');
  },
};
