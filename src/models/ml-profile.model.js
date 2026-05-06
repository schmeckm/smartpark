const { Model, DataTypes } = require('sequelize');

class MlProfile extends Model {}

function defineMlProfile(sequelize) {
  MlProfile.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      profileCode: { type: DataTypes.STRING(80), allowNull: false, unique: true, field: 'profile_code' },
      profileName: { type: DataTypes.STRING(200), allowNull: false, field: 'profile_name' },
      entityType: { type: DataTypes.STRING(32), allowNull: false, field: 'entity_type' },
      category: { type: DataTypes.STRING(80), allowNull: true },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active_flag' },
      weatherSensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'weather_sensitive' },
      rainSensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'rain_sensitive' },
      windSensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'wind_sensitive' },
      heatSensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'heat_sensitive' },
      weatherSensitivityScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'weather_sensitivity_score' },
      rainImpactScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'rain_impact_score' },
      windImpactScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'wind_impact_score' },
      heatImpactScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'heat_impact_score' },
      queueElasticityScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'queue_elasticity_score' },
      capacityElasticityScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'capacity_elasticity_score' },
      staffDependencyScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'staff_dependency_score' },
      downtimeRiskScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'downtime_risk_score' },
      maintenanceCriticality: { type: DataTypes.DECIMAL(6, 4), allowNull: true, field: 'maintenance_criticality' },
      targetThroughputFactor: { type: DataTypes.DECIMAL(8, 4), allowNull: true, field: 'target_throughput_factor' },
      maxQueueTargetMin: { type: DataTypes.INTEGER, allowNull: true, field: 'max_queue_target_min' },
      availabilityTargetPercent: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'availability_target_percent' },
      modelType: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'BASELINE', field: 'model_type' },
      featureSetCode: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'DEFAULT_V1', field: 'feature_set_code' },
      downtimeImpactLevel: { type: DataTypes.STRING(40), allowNull: true, field: 'downtime_impact_level' },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'MlProfile',
      tableName: 'ml_profiles',
      underscored: true,
    }
  );
  return MlProfile;
}

module.exports = { defineMlProfile, MlProfile };
