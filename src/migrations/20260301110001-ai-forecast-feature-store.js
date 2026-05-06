'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('park_feature_snapshots_5m', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      external_park_id: { type: Sequelize.STRING(255), allowNull: false },
      snapshot_at: { type: Sequelize.DATE, allowNull: false },
      timezone: { type: Sequelize.STRING(64), allowNull: true },
      rides_reporting: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      rides_open: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      open_ratio: { type: Sequelize.DECIMAL(8, 6), allowNull: false, defaultValue: 0 },
      avg_wait: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      median_wait: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      p90_wait: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      max_wait: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      closed_ratio: { type: Sequelize.DECIMAL(8, 6), allowNull: false, defaultValue: 0 },
      source_message_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('park_feature_snapshots_5m', ['provider', 'external_park_id', 'snapshot_at'], {
      unique: true,
      name: 'uq_park_feature_snapshots_5m_provider_park_snapshot',
    });
    await queryInterface.addIndex('park_feature_snapshots_5m', ['snapshot_at'], {
      name: 'idx_park_feature_snapshots_5m_snapshot_at',
    });

    await queryInterface.createTable('ride_feature_snapshots_5m', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      external_park_id: { type: Sequelize.STRING(255), allowNull: false },
      external_entity_id: { type: Sequelize.STRING(255), allowNull: false },
      entity_type: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'ATTRACTION' },
      snapshot_at: { type: Sequelize.DATE, allowNull: false },
      wait_time: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      status: { type: Sequelize.STRING(80), allowNull: true },
      is_open: { type: Sequelize.BOOLEAN, allowNull: true },
      has_wait_sample: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ride_feature_snapshots_5m', ['provider', 'external_entity_id', 'snapshot_at'], {
      unique: true,
      name: 'uq_ride_feature_snapshots_5m_provider_entity_snapshot',
    });
    await queryInterface.addIndex('ride_feature_snapshots_5m', ['provider', 'external_park_id', 'snapshot_at'], {
      name: 'idx_ride_feature_snapshots_5m_provider_park_snapshot',
    });

    await queryInterface.createTable('forecast_training_labels', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      scope: { type: Sequelize.STRING(16), allowNull: false },
      provider: { type: Sequelize.STRING(64), allowNull: false },
      external_park_id: { type: Sequelize.STRING(255), allowNull: false },
      external_entity_id: { type: Sequelize.STRING(255), allowNull: true },
      base_snapshot_at: { type: Sequelize.DATE, allowNull: false },
      horizon_minutes: { type: Sequelize.INTEGER, allowNull: false },
      label_wait: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      label_crowd_index: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
      label_open_ratio: { type: Sequelize.DECIMAL(8, 6), allowNull: true },
      label_quality: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'OK' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex(
      'forecast_training_labels',
      ['scope', 'provider', 'external_park_id', 'external_entity_id', 'base_snapshot_at', 'horizon_minutes'],
      {
        unique: true,
        name: 'uq_forecast_training_labels_scope_provider_park_entity_base_horizon',
      }
    );

    await queryInterface.createTable('model_metrics_daily', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      model_version_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'ml_model_versions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      scope: { type: Sequelize.STRING(16), allowNull: false },
      horizon_minutes: { type: Sequelize.INTEGER, allowNull: false },
      metric_date: { type: Sequelize.DATEONLY, allowNull: false },
      mae: { type: Sequelize.DECIMAL(12, 6), allowNull: true },
      mape: { type: Sequelize.DECIMAL(12, 6), allowNull: true },
      rmse: { type: Sequelize.DECIMAL(12, 6), allowNull: true },
      sample_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('model_metrics_daily', ['model_version_id', 'scope', 'horizon_minutes', 'metric_date'], {
      unique: true,
      name: 'uq_model_metrics_daily_model_scope_horizon_date',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('model_metrics_daily');
    await queryInterface.dropTable('forecast_training_labels');
    await queryInterface.dropTable('ride_feature_snapshots_5m');
    await queryInterface.dropTable('park_feature_snapshots_5m');
  },
};

