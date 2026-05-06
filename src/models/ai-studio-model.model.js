const { Model, DataTypes } = require('sequelize');

class AiStudioModel extends Model {}

function defineAiStudioModel(sequelize) {
  AiStudioModel.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      modelScope: { type: DataTypes.STRING(16), allowNull: false, field: 'model_scope' },
      entityType: { type: DataTypes.STRING(32), allowNull: false, field: 'entity_type' },
      entityId: { type: DataTypes.UUID, allowNull: true, field: 'entity_id' },
      targetVariable: { type: DataTypes.STRING(64), allowNull: false, field: 'target_variable' },
      featuresJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'features_json' },
      strategy: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'MANUAL' },
      algorithm: { type: DataTypes.STRING(48), allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      mae: { type: DataTypes.DOUBLE, allowNull: true },
      rmse: { type: DataTypes.DOUBLE, allowNull: true },
      r2: { type: DataTypes.DOUBLE, allowNull: true },
      lastTrainingAt: { type: DataTypes.DATE, allowNull: false, field: 'last_training_at' },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'active_flag' },
      modelPayload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'model_payload' },
      featureImportanceJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'feature_importance_json' },
      evalHoldoutJson: { type: DataTypes.JSONB, allowNull: true, field: 'eval_holdout_json' },
      datasetSnapshotJson: { type: DataTypes.JSONB, allowNull: true, field: 'dataset_snapshot_json' },
    },
    {
      sequelize,
      modelName: 'AiStudioModel',
      tableName: 'ai_studio_models',
      underscored: true,
      timestamps: true,
    }
  );
  return AiStudioModel;
}

module.exports = { defineAiStudioModel, AiStudioModel };
