'use strict';

/**
 * Enterprise ML influence framework (Level 1 global, Level 2 park, Level 3 profiles).
 * Additive only; does not remove legacy ride_master_data ML fields.
 *
 * @param {import('sequelize').QueryInterface} queryInterface
 * @param {import('sequelize').Sequelize} Sequelize
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ml_global_factors', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      factor_code: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      factor_name: { type: Sequelize.STRING(200), allowNull: false },
      factor_group: { type: Sequelize.STRING(80), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      active_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      weight: { type: Sequelize.DECIMAL(10, 4), allowNull: false, defaultValue: 1 },
      lag_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      default_value: { type: Sequelize.DECIMAL(12, 6), allowNull: true },
      current_value: { type: Sequelize.DECIMAL(12, 6), allowNull: true },
      source_type: {
        type: Sequelize.STRING(24),
        allowNull: false,
        defaultValue: 'MANUAL',
      },
      unit: { type: Sequelize.STRING(40), allowNull: true },
      valid_from: { type: Sequelize.DATEONLY, allowNull: true },
      valid_to: { type: Sequelize.DATEONLY, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ml_global_factors', ['active_flag'], { name: 'idx_ml_global_factors_active' });
    await queryInterface.addIndex('ml_global_factors', ['factor_group'], { name: 'idx_ml_global_factors_group' });

    await queryInterface.createTable('ml_park_factors', {
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
      factor_code: { type: Sequelize.STRING(80), allowNull: false },
      active_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      weight_override: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      current_value: { type: Sequelize.DECIMAL(12, 6), allowNull: true },
      source_type: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'MANUAL' },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addConstraint('ml_park_factors', {
      fields: ['park_id', 'factor_code'],
      type: 'unique',
      name: 'uq_ml_park_factors_park_code',
    });
    await queryInterface.addIndex('ml_park_factors', ['park_id'], { name: 'idx_ml_park_factors_park' });

    await queryInterface.createTable('ml_profiles', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      profile_code: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      profile_name: { type: Sequelize.STRING(200), allowNull: false },
      entity_type: { type: Sequelize.STRING(32), allowNull: false },
      category: { type: Sequelize.STRING(80), allowNull: true },
      active_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      weather_sensitive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      rain_sensitive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      wind_sensitive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      heat_sensitive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      weather_sensitivity_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      rain_impact_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      wind_impact_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      heat_impact_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      queue_elasticity_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      capacity_elasticity_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      staff_dependency_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      downtime_risk_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      maintenance_criticality: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      target_throughput_factor: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
      max_queue_target_min: { type: Sequelize.INTEGER, allowNull: true },
      availability_target_percent: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
      model_type: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'BASELINE' },
      feature_set_code: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'DEFAULT_V1' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ml_profiles', ['entity_type', 'active_flag'], { name: 'idx_ml_profiles_entity_active' });

    await queryInterface.createTable('asset_ml_profile_assignments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      profile_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'ml_profiles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      active_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      valid_from: { type: Sequelize.DATEONLY, allowNull: true },
      valid_to: { type: Sequelize.DATEONLY, allowNull: true },
      assigned_by: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('asset_ml_profile_assignments', ['asset_id', 'active_flag'], {
      name: 'idx_asset_ml_profile_assignments_asset_active',
    });

    await queryInterface.createTable('asset_ml_overrides', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      override_key: { type: Sequelize.STRING(120), allowNull: false },
      override_value_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      override_reason: { type: Sequelize.TEXT, allowNull: true },
      active_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addConstraint('asset_ml_overrides', {
      fields: ['asset_id', 'override_key'],
      type: 'unique',
      name: 'uq_asset_ml_overrides_asset_key',
    });

    const parkSnapAdds = {
      rain_probability_percent: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
      inbound_eta_min: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
      visitors_estimate: { type: Sequelize.INTEGER, allowNull: true },
      open_rides_count: { type: Sequelize.INTEGER, allowNull: true },
      closed_rides_count: { type: Sequelize.INTEGER, allowNull: true },
      crowd_index: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
    };
    for (const [col, def] of Object.entries(parkSnapAdds)) {
      await queryInterface.addColumn('park_feature_snapshots_5m', col, def);
    }

    const rideSnapAdds = {
      rain_probability_percent: { type: Sequelize.DECIMAL(6, 2), allowNull: true },
      inbound_eta_min: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
      capacity_factor: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
      ml_profile_code: { type: Sequelize.STRING(80), allowNull: true },
      weather_sensitivity_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      queue_elasticity_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      staff_dependency_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      target_wait_time_15m: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      target_wait_time_60m: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
    };
    for (const [col, def] of Object.entries(rideSnapAdds)) {
      await queryInterface.addColumn('ride_feature_snapshots_5m', col, def);
    }
  },

  async down(queryInterface) {
    const rideCols = [
      'target_wait_time_60m',
      'target_wait_time_15m',
      'staff_dependency_score',
      'queue_elasticity_score',
      'weather_sensitivity_score',
      'ml_profile_code',
      'capacity_factor',
      'inbound_eta_min',
      'rain_probability_percent',
    ];
    const parkCols = [
      'crowd_index',
      'closed_rides_count',
      'open_rides_count',
      'visitors_estimate',
      'inbound_eta_min',
      'rain_probability_percent',
    ];
    for (const c of rideCols) {
      await queryInterface.removeColumn('ride_feature_snapshots_5m', c);
    }
    for (const c of parkCols) {
      await queryInterface.removeColumn('park_feature_snapshots_5m', c);
    }
    await queryInterface.dropTable('asset_ml_overrides');
    await queryInterface.dropTable('asset_ml_profile_assignments');
    await queryInterface.dropTable('ml_profiles');
    await queryInterface.dropTable('ml_park_factors');
    await queryInterface.dropTable('ml_global_factors');
  },
};
