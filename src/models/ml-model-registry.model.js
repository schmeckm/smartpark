const { Model, DataTypes } = require('sequelize');

class MlModelRegistry extends Model {}

function defineMlModelRegistry(sequelize) {
  MlModelRegistry.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      modelId: { type: DataTypes.STRING(160), allowNull: false, field: 'model_id' },
      modelType: { type: DataTypes.STRING(64), allowNull: false, field: 'model_type' },
      scopeType: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'global', field: 'scope_type' },
      scopeId: { type: DataTypes.STRING(255), allowNull: true, field: 'scope_id' },
      target: { type: DataTypes.STRING(64), allowNull: false },
      horizonMinutes: { type: DataTypes.INTEGER, allowNull: false, field: 'horizon_minutes' },
      featureList: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'feature_list' },
      modelPayload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'model_payload' },
      metrics: { type: DataTypes.JSONB, allowNull: true },
      trainingRows: { type: DataTypes.INTEGER, allowNull: true, field: 'training_rows' },
      trainedAt: { type: DataTypes.DATE, allowNull: true, field: 'trained_at' },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    },
    {
      sequelize,
      modelName: 'MlModelRegistry',
      tableName: 'ml_model_registry',
      underscored: true,
    }
  );
  return MlModelRegistry;
}

module.exports = { defineMlModelRegistry, MlModelRegistry };
