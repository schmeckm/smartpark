const { Model, DataTypes } = require('sequelize');

class ModelMetricsDaily extends Model {}

function defineModelMetricsDaily(sequelize) {
  ModelMetricsDaily.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      modelVersionId: { type: DataTypes.UUID, allowNull: false, field: 'model_version_id' },
      scope: { type: DataTypes.STRING(16), allowNull: false },
      horizonMinutes: { type: DataTypes.INTEGER, allowNull: false, field: 'horizon_minutes' },
      metricDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'metric_date' },
      mae: { type: DataTypes.DECIMAL(12, 6), allowNull: true },
      mape: { type: DataTypes.DECIMAL(12, 6), allowNull: true },
      rmse: { type: DataTypes.DECIMAL(12, 6), allowNull: true },
      sampleCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sample_count' },
    },
    {
      sequelize,
      modelName: 'ModelMetricsDaily',
      tableName: 'model_metrics_daily',
      underscored: true,
    }
  );
  return ModelMetricsDaily;
}

module.exports = { defineModelMetricsDaily, ModelMetricsDaily };

