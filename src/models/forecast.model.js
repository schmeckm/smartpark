const { Model, DataTypes } = require('sequelize');

const SUBJECT_TYPES = ['PARK', 'ZONE', 'RIDE'];
const TARGET_METRICS = ['CROWD_LEVEL', 'WAIT_TIME', 'STAFF_DEMAND'];

class Forecast extends Model {}

function defineForecast(sequelize) {
  Forecast.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      subjectType: {
        type: DataTypes.ENUM(...SUBJECT_TYPES),
        allowNull: false,
        field: 'subject_type',
      },
      subjectId: { type: DataTypes.UUID, allowNull: true, field: 'subject_id' },
      targetMetric: {
        type: DataTypes.ENUM(...TARGET_METRICS),
        allowNull: false,
        field: 'target_metric',
      },
      horizonMinutes: { type: DataTypes.INTEGER, allowNull: false, field: 'horizon_minutes' },
      predictedValue: { type: DataTypes.DECIMAL(16, 4), allowNull: false, field: 'predicted_value' },
      confidence: { type: DataTypes.DECIMAL(8, 6), allowNull: true },
      predictionBand: { type: DataTypes.JSONB, allowNull: true, field: 'prediction_band' },
      modelVersionId: { type: DataTypes.UUID, allowNull: true, field: 'model_version_id' },
      features: { type: DataTypes.JSONB, allowNull: true },
      producedAt: { type: DataTypes.DATE, allowNull: false, field: 'produced_at' },
      expiresAt: { type: DataTypes.DATE, allowNull: true, field: 'expires_at' },
    },
    {
      sequelize,
      modelName: 'Forecast',
      tableName: 'forecasts',
      underscored: true,
    }
  );
  return Forecast;
}

module.exports = { defineForecast, Forecast, SUBJECT_TYPES, TARGET_METRICS };
