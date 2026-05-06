const { Model, DataTypes, Sequelize } = require('sequelize');

class ForecastTrainingLabel extends Model {}

function defineForecastTrainingLabel(sequelize) {
  ForecastTrainingLabel.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      scope: { type: DataTypes.STRING(16), allowNull: false },
      provider: { type: DataTypes.STRING(64), allowNull: false },
      externalParkId: { type: DataTypes.STRING(255), allowNull: false, field: 'external_park_id' },
      externalEntityId: { type: DataTypes.STRING(255), allowNull: true, field: 'external_entity_id' },
      baseSnapshotAt: { type: DataTypes.DATE, allowNull: false, field: 'base_snapshot_at' },
      horizonMinutes: { type: DataTypes.INTEGER, allowNull: false, field: 'horizon_minutes' },
      labelWait: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'label_wait' },
      labelCrowdIndex: { type: DataTypes.DECIMAL(8, 4), allowNull: true, field: 'label_crowd_index' },
      labelOpenRatio: { type: DataTypes.DECIMAL(8, 6), allowNull: true, field: 'label_open_ratio' },
      labelQuality: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'OK', field: 'label_quality' },
    },
    {
      sequelize,
      modelName: 'ForecastTrainingLabel',
      tableName: 'forecast_training_labels',
      underscored: true,
      indexes: [
        {
          name: 'uq_ftl_park_provider_park_base_horizon_null_entity',
          unique: true,
          fields: ['provider', 'external_park_id', 'base_snapshot_at', 'horizon_minutes'],
          where: { external_entity_id: null },
        },
        {
          name: 'uq_ftl_entity_provider_park_entity_base_horizon',
          unique: true,
          fields: ['provider', 'external_park_id', 'external_entity_id', 'base_snapshot_at', 'horizon_minutes'],
          where: Sequelize.literal('external_entity_id IS NOT NULL'),
        },
      ],
    }
  );
  return ForecastTrainingLabel;
}

module.exports = { defineForecastTrainingLabel, ForecastTrainingLabel };

