const { Model, DataTypes } = require('sequelize');

class MlPredictionResult extends Model {}

function defineMlPredictionResult(sequelize) {
  MlPredictionResult.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      predictionId: { type: DataTypes.UUID, allowNull: false, field: 'prediction_id' },
      parkId: { type: DataTypes.UUID, allowNull: true, field: 'park_id' },
      rideId: { type: DataTypes.UUID, allowNull: true, field: 'ride_id' },
      modelName: { type: DataTypes.STRING(160), allowNull: false, field: 'model_name' },
      modelVersion: { type: DataTypes.STRING(160), allowNull: true, field: 'model_version' },
      targetName: { type: DataTypes.STRING(160), allowNull: false, field: 'target_name' },
      horizonMinutes: { type: DataTypes.INTEGER, allowNull: true, field: 'horizon_minutes' },
      predictedValue: { type: DataTypes.DECIMAL(12, 4), allowNull: true, field: 'predicted_value' },
      actualValue: { type: DataTypes.DECIMAL(12, 4), allowNull: true, field: 'actual_value' },
      confidenceScore: { type: DataTypes.DECIMAL(8, 4), allowNull: true, field: 'confidence_score' },
      reasonCodesJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'reason_codes_json' },
      fallbackUsed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'fallback_used' },
    },
    {
      sequelize,
      modelName: 'MlPredictionResult',
      tableName: 'ml_prediction_results',
      underscored: true,
    }
  );
  return MlPredictionResult;
}

module.exports = { defineMlPredictionResult, MlPredictionResult };
