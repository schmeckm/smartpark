const { Model, DataTypes } = require('sequelize');

class MlForecastAccuracyLog extends Model {}

function defineMlForecastAccuracyLog(sequelize) {
  MlForecastAccuracyLog.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      predictionId: { type: DataTypes.UUID, allowNull: true, field: 'prediction_id' },
      parkId: { type: DataTypes.UUID, allowNull: true, field: 'park_id' },
      rideId: { type: DataTypes.UUID, allowNull: true, field: 'ride_id' },
      modelName: { type: DataTypes.STRING(160), allowNull: true, field: 'model_name' },
      modelVersion: { type: DataTypes.STRING(160), allowNull: true, field: 'model_version' },
      targetName: { type: DataTypes.STRING(160), allowNull: false, field: 'target_name' },
      horizonMinutes: { type: DataTypes.INTEGER, allowNull: false, field: 'horizon_minutes' },
      predictedValue: { type: DataTypes.DECIMAL(14, 6), allowNull: true, field: 'predicted_value' },
      actualValue: { type: DataTypes.DECIMAL(14, 6), allowNull: true, field: 'actual_value' },
      absoluteError: { type: DataTypes.DECIMAL(14, 6), allowNull: true, field: 'absolute_error' },
      percentageError: { type: DataTypes.DECIMAL(14, 8), allowNull: true, field: 'percentage_error' },
      squaredError: { type: DataTypes.DECIMAL(20, 10), allowNull: true, field: 'squared_error' },
      bias: { type: DataTypes.DECIMAL(14, 6), allowNull: true, field: 'bias' },
      accuracyStatus: { type: DataTypes.STRING(16), allowNull: true, field: 'accuracy_status' },
      evaluatedAt: { type: DataTypes.DATE, allowNull: false, field: 'evaluated_at' },
      evaluationReason: { type: DataTypes.STRING(80), allowNull: true, field: 'evaluation_reason' },
    },
    {
      sequelize,
      modelName: 'MlForecastAccuracyLog',
      tableName: 'ml_forecast_accuracy_logs',
      underscored: true,
    }
  );
  return MlForecastAccuracyLog;
}

module.exports = { defineMlForecastAccuracyLog, MlForecastAccuracyLog };
