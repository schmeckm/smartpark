'use strict';

/** X-feature extensions for 5m ML feature store (nullable; UTC snapshot_at; local_* from park TZ). */

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    const parkAdds = {
      internal_park_id: { type: Sequelize.UUID, allowNull: true },
      local_date: { type: Sequelize.DATEONLY, allowNull: true },
      local_hour: { type: Sequelize.SMALLINT, allowNull: true },
      day_of_week: { type: Sequelize.SMALLINT, allowNull: true },
      month: { type: Sequelize.SMALLINT, allowNull: true },
      season: { type: Sequelize.SMALLINT, allowNull: true },
      is_weekend: { type: Sequelize.BOOLEAN, allowNull: true },
      is_public_holiday: { type: Sequelize.BOOLEAN, allowNull: true },
      is_school_holiday: { type: Sequelize.BOOLEAN, allowNull: true },
      holiday_name: { type: Sequelize.STRING(200), allowNull: true },
      temperature_c: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
      precipitation_mm: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      wind_speed_kmh: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
      weather_condition: { type: Sequelize.STRING(80), allowNull: true },
      traffic_index: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
      special_event_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      park_crowd_index: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
      completeness_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      target_wait_time_15m: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      target_wait_time_60m: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      target_wait_time_120m: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      x_features_extras: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
    };
    const rideAdds = {
      internal_park_id: { type: Sequelize.UUID, allowNull: true },
      internal_asset_id: { type: Sequelize.UUID, allowNull: true },
      current_wait_time_min: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      previous_wait_time_min: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      wait_time_delta_5m: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      rolling_avg_wait_15m: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      rolling_avg_wait_60m: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      theoretical_capacity_pph: { type: Sequelize.INTEGER, allowNull: true },
      staffing_gap_normal: { type: Sequelize.INTEGER, allowNull: true },
      rain_sensitive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      weather_sensitive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      park_crowd_index: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
      temperature_c: { type: Sequelize.DECIMAL(8, 2), allowNull: true },
      precipitation_mm: { type: Sequelize.DECIMAL(10, 4), allowNull: true },
      is_public_holiday: { type: Sequelize.BOOLEAN, allowNull: true },
      is_school_holiday: { type: Sequelize.BOOLEAN, allowNull: true },
      traffic_index: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
      special_event_flag: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      completeness_score: { type: Sequelize.DECIMAL(6, 4), allowNull: true },
      x_features_extras: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
    };

    for (const [col, def] of Object.entries(parkAdds)) {
      await queryInterface.addColumn('park_feature_snapshots_5m', col, def);
    }
    for (const [col, def] of Object.entries(rideAdds)) {
      await queryInterface.addColumn('ride_feature_snapshots_5m', col, def);
    }
    await queryInterface.addIndex('park_feature_snapshots_5m', ['internal_park_id', 'snapshot_at'], {
      name: 'idx_park_feature_snapshots_5m_internal_park_snapshot',
    });
    await queryInterface.addIndex('ride_feature_snapshots_5m', ['internal_park_id', 'internal_asset_id', 'snapshot_at'], {
      name: 'idx_ride_feature_snapshots_5m_internal_asset_snapshot',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('ride_feature_snapshots_5m', 'idx_ride_feature_snapshots_5m_internal_asset_snapshot');
    await queryInterface.removeIndex('park_feature_snapshots_5m', 'idx_park_feature_snapshots_5m_internal_park_snapshot');
    const rideNames = [
      'x_features_extras',
      'completeness_score',
      'special_event_flag',
      'traffic_index',
      'is_school_holiday',
      'is_public_holiday',
      'precipitation_mm',
      'temperature_c',
      'park_crowd_index',
      'weather_sensitive',
      'rain_sensitive',
      'staffing_gap_normal',
      'theoretical_capacity_pph',
      'rolling_avg_wait_60m',
      'rolling_avg_wait_15m',
      'wait_time_delta_5m',
      'previous_wait_time_min',
      'current_wait_time_min',
      'internal_asset_id',
      'internal_park_id',
    ];
    const parkNames = [
      'x_features_extras',
      'target_wait_time_120m',
      'target_wait_time_60m',
      'target_wait_time_15m',
      'completeness_score',
      'park_crowd_index',
      'special_event_flag',
      'traffic_index',
      'weather_condition',
      'wind_speed_kmh',
      'precipitation_mm',
      'temperature_c',
      'holiday_name',
      'is_school_holiday',
      'is_public_holiday',
      'is_weekend',
      'season',
      'month',
      'day_of_week',
      'local_hour',
      'local_date',
      'internal_park_id',
    ];
    for (const col of rideNames) {
      await queryInterface.removeColumn('ride_feature_snapshots_5m', col);
    }
    for (const col of parkNames) {
      await queryInterface.removeColumn('park_feature_snapshots_5m', col);
    }
  },
};
