const { Model, DataTypes } = require('sequelize');

class MlParkFactor extends Model {}

function defineMlParkFactor(sequelize) {
  MlParkFactor.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      factorCode: { type: DataTypes.STRING(80), allowNull: false, field: 'factor_code' },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active_flag' },
      weightOverride: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'weight_override' },
      currentValue: { type: DataTypes.DECIMAL(12, 6), allowNull: true, field: 'current_value' },
      sourceType: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'MANUAL', field: 'source_type' },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'MlParkFactor',
      tableName: 'ml_park_factors',
      underscored: true,
    }
  );
  return MlParkFactor;
}

module.exports = { defineMlParkFactor, MlParkFactor };
