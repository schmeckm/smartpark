const { Model, DataTypes } = require('sequelize');

class RideFeatureSnapshot extends Model {}

function defineRideFeatureSnapshot(sequelize) {
  RideFeatureSnapshot.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      provider: { type: DataTypes.STRING(64), allowNull: false },
      externalParkId: { type: DataTypes.STRING(255), allowNull: false, field: 'external_park_id' },
      externalEntityId: { type: DataTypes.STRING(255), allowNull: false, field: 'external_entity_id' },
      entityType: { type: DataTypes.STRING(80), allowNull: false, field: 'entity_type' },
      snapshotAt: { type: DataTypes.DATE, allowNull: false, field: 'snapshot_at' },
      waitTime: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'wait_time' },
      status: { type: DataTypes.STRING(80), allowNull: true },
      isOpen: { type: DataTypes.BOOLEAN, allowNull: true, field: 'is_open' },
      hasWaitSample: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'has_wait_sample' },
      internalParkId: { type: DataTypes.UUID, allowNull: true, field: 'internal_park_id' },
      internalAssetId: { type: DataTypes.UUID, allowNull: true, field: 'internal_asset_id' },
      currentWaitTimeMin: { type: DataTypes.DECIMAL(10, 2), allowNull: true, field: 'current_wait_time_min' },
      previousWaitTimeMin: { type: DataTypes.DECIMAL(10, 2), allowNull: true, field: 'previous_wait_time_min' },
      waitTimeDelta5m: { type: DataTypes.DECIMAL(10, 2), allowNull: true, field: 'wait_time_delta_5m' },
      rollingAvgWait15m: { type: DataTypes.DECIMAL(10, 2), allowNull: true, field: 'rolling_avg_wait_15m' },
      rollingAvgWait60m: { type: DataTypes.DECIMAL(10, 2), allowNull: true, field: 'rolling_avg_wait_60m' },
      theoreticalCapacityPph: { type: DataTypes.INTEGER, allowNull: true, field: 'theoretical_capacity_pph' },
      staffingGapNormal: { type: DataTypes.INTEGER, allowNull: true, field: 'staffing_gap_normal' },
      rainSensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'rain_sensitive' },
      weatherSensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'weather_sensitive' },
      parkCrowdIndex: { type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'park_crowd_index' },
      temperatureC: { type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'temperature_c' },
      precipitationMm: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'precipitation_mm' },
      isPublicHoliday: { type: DataTypes.BOOLEAN, allowNull: true, field: 'is_public_holiday' },
      isSchoolHoliday: { type: DataTypes.BOOLEAN, allowNull: true, field: 'is_school_holiday' },
      trafficIndex: { type: DataTypes.DECIMAL(8, 4), allowNull: true, field: 'traffic_index' },
      specialEventFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'special_event_flag' },
      completenessScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'completeness_score' },
      xFeaturesExtras: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'x_features_extras' },
      rainProbabilityPercent: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'rain_probability_percent' },
      inboundEtaMin: { type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'inbound_eta_min' },
      capacityFactor: { type: DataTypes.DECIMAL(8, 4), allowNull: true, field: 'capacity_factor' },
      mlProfileCode: { type: DataTypes.STRING(80), allowNull: true, field: 'ml_profile_code' },
      weatherSensitivityScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'weather_sensitivity_score' },
      queueElasticityScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'queue_elasticity_score' },
      staffDependencyScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'staff_dependency_score' },
      targetWaitTime15m: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'target_wait_time_15m' },
      targetWaitTime60m: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'target_wait_time_60m' },
    },
    {
      sequelize,
      modelName: 'RideFeatureSnapshot',
      tableName: 'ride_feature_snapshots_5m',
      underscored: true,
    }
  );
  return RideFeatureSnapshot;
}

module.exports = { defineRideFeatureSnapshot, RideFeatureSnapshot };
