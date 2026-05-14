const { Model, DataTypes } = require('sequelize');

class MlParkProfile extends Model {}

function defineMlParkProfile(sequelize) {
  MlParkProfile.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      profileName: { type: DataTypes.STRING(255), allowNull: false, field: 'profile_name' },
      profileVersion: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'v1',
        field: 'profile_version',
      },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      crowdProfileJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'crowd_profile_json' },
      weatherProfileJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'weather_profile_json',
      },
      calendarProfileJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'calendar_profile_json',
      },
      seasonalityProfileJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'seasonality_profile_json',
      },
      eventProfileJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'event_profile_json' },
      visitorMixProfileJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'visitor_mix_profile_json',
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
      modelName: 'MlParkProfile',
      tableName: 'ml_park_profiles',
      underscored: true,
    }
  );
  return MlParkProfile;
}

module.exports = { defineMlParkProfile, MlParkProfile };
