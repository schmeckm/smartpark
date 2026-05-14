const { Model, DataTypes } = require('sequelize');

class MlPredictionTrace extends Model {}

function defineMlPredictionTrace(sequelize) {
  MlPredictionTrace.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      predictionId: { type: DataTypes.UUID, allowNull: false, field: 'prediction_id' },
      parkId: { type: DataTypes.UUID, allowNull: true, field: 'park_id' },
      rideId: { type: DataTypes.UUID, allowNull: true, field: 'ride_id' },
      modelName: { type: DataTypes.STRING(160), allowNull: false, field: 'model_name' },
      modelVersion: { type: DataTypes.STRING(160), allowNull: true, field: 'model_version' },
      targetName: { type: DataTypes.STRING(160), allowNull: false, field: 'target_name' },
      horizonMinutes: { type: DataTypes.INTEGER, allowNull: true, field: 'horizon_minutes' },
      featureVectorJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'feature_vector_json' },
      featureSourcesJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'feature_sources_json' },
      featureStatusJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'feature_status_json' },
      missingFeaturesJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'missing_features_json' },
      fallbackUsed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'fallback_used' },
      predictionInputHash: { type: DataTypes.STRING(128), allowNull: true, field: 'prediction_input_hash' },
      weightedFeatureVectorJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'weighted_feature_vector_json',
      },
      governedSnapshotQualityReason: {
        type: DataTypes.STRING(80),
        allowNull: true,
        field: 'governed_snapshot_quality_reason',
      },
    },
    {
      sequelize,
      modelName: 'MlPredictionTrace',
      tableName: 'ml_prediction_traces',
      underscored: true,
    }
  );
  return MlPredictionTrace;
}

module.exports = { defineMlPredictionTrace, MlPredictionTrace };
