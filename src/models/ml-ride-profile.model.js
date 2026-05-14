const { Model, DataTypes } = require('sequelize');

class MlRideProfile extends Model {}

function defineMlRideProfile(sequelize) {
  MlRideProfile.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      rideId: { type: DataTypes.UUID, allowNull: false, field: 'ride_id' },
      profileName: { type: DataTypes.STRING(255), allowNull: false, field: 'profile_name' },
      profileVersion: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'v1',
        field: 'profile_version',
      },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      rideType: { type: DataTypes.STRING(128), allowNull: true, field: 'ride_type' },
      capacityProfileJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'capacity_profile_json',
      },
      popularityProfileJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'popularity_profile_json',
      },
      queueBehaviorProfileJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'queue_behavior_profile_json',
      },
      weatherSensitivityJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'weather_sensitivity_json',
      },
      downtimeSensitivityJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'downtime_sensitivity_json',
      },
      staffingDependencyJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'staffing_dependency_json',
      },
      throughputProfileJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'throughput_profile_json',
      },
      featureWeightsJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'feature_weights_json',
      },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'MlRideProfile',
      tableName: 'ml_ride_profiles',
      underscored: true,
    }
  );
  return MlRideProfile;
}

module.exports = { defineMlRideProfile, MlRideProfile };
