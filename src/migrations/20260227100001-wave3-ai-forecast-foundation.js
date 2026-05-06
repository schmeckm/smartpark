'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('zone_crowd_samples', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      zone_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'zones', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      crowd_level: { type: Sequelize.INTEGER, allowNull: false },
      crowd_ratio: { type: Sequelize.DECIMAL(12, 6), allowNull: false },
      source: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'sampler' },
      sampled_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('zone_crowd_samples', ['zone_id', 'sampled_at'], { name: 'idx_zone_crowd_samples_zone_sampled' });
    await queryInterface.addIndex('zone_crowd_samples', ['sampled_at'], { name: 'idx_zone_crowd_samples_sampled' });

    await queryInterface.createTable('ml_model_versions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      model_name: { type: Sequelize.STRING(120), allowNull: false },
      model_type: { type: Sequelize.STRING(64), allowNull: false },
      version: { type: Sequelize.STRING(32), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'ACTIVE' },
      metrics: { type: Sequelize.JSONB, allowNull: true },
      trained_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ml_model_versions', ['model_name', 'version'], { name: 'idx_ml_model_versions_name_ver', unique: true });

    await queryInterface.createTable('forecasts', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      subject_type: { type: Sequelize.ENUM('PARK', 'ZONE', 'RIDE'), allowNull: false },
      subject_id: { type: Sequelize.UUID, allowNull: true },
      target_metric: { type: Sequelize.ENUM('CROWD_LEVEL', 'WAIT_TIME', 'STAFF_DEMAND'), allowNull: false },
      horizon_minutes: { type: Sequelize.INTEGER, allowNull: false },
      predicted_value: { type: Sequelize.DECIMAL(16, 4), allowNull: false },
      confidence: { type: Sequelize.DECIMAL(8, 6), allowNull: true },
      prediction_band: { type: Sequelize.JSONB, allowNull: true },
      model_version_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'ml_model_versions', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      features: { type: Sequelize.JSONB, allowNull: true },
      produced_at: { type: Sequelize.DATE, allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('forecasts', ['subject_type', 'subject_id', 'target_metric', 'horizon_minutes', 'produced_at'], {
      name: 'idx_forecasts_lookup',
    });
    await queryInterface.addIndex('forecasts', ['produced_at'], { name: 'idx_forecasts_produced' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('forecasts');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_forecasts_subject_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_forecasts_target_metric";');
    await queryInterface.dropTable('ml_model_versions');
    await queryInterface.dropTable('zone_crowd_samples');
  },
};
