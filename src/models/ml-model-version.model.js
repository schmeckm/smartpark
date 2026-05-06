const { Model, DataTypes } = require('sequelize');

class MlModelVersion extends Model {}

function defineMlModelVersion(sequelize) {
  MlModelVersion.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      modelName: { type: DataTypes.STRING(120), allowNull: false, field: 'model_name' },
      modelType: { type: DataTypes.STRING(64), allowNull: false, field: 'model_type' },
      version: { type: DataTypes.STRING(32), allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'ACTIVE' },
      metrics: { type: DataTypes.JSONB, allowNull: true },
      trainedAt: { type: DataTypes.DATE, allowNull: true, field: 'trained_at' },
    },
    {
      sequelize,
      modelName: 'MlModelVersion',
      tableName: 'ml_model_versions',
      underscored: true,
    }
  );
  return MlModelVersion;
}

module.exports = { defineMlModelVersion, MlModelVersion };
