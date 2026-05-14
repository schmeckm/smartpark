const { Model, DataTypes } = require('sequelize');

class MlGlobalFactor extends Model {}

function defineMlGlobalFactor(sequelize) {
  MlGlobalFactor.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      factorCode: { type: DataTypes.STRING(80), allowNull: false, unique: true, field: 'factor_code' },
      factorName: { type: DataTypes.STRING(200), allowNull: false, field: 'factor_name' },
      factorGroup: { type: DataTypes.STRING(80), allowNull: true, field: 'factor_group' },
      description: { type: DataTypes.TEXT, allowNull: true },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active_flag' },
      weight: { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 1 },
      lagMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'lag_minutes' },
      defaultValue: { type: DataTypes.DECIMAL(12, 6), allowNull: true, field: 'default_value' },
      currentValue: { type: DataTypes.DECIMAL(12, 6), allowNull: true, field: 'current_value' },
      sourceType: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'MANUAL', field: 'source_type' },
      adapterKey: { type: DataTypes.STRING(120), allowNull: true, field: 'adapter_key' },
      mqttTopic: { type: DataTypes.STRING(500), allowNull: true, field: 'mqtt_topic' },
      unit: { type: DataTypes.STRING(40), allowNull: true },
      validFrom: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_from' },
      validTo: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_to' },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'MlGlobalFactor',
      tableName: 'ml_global_factors',
      underscored: true,
    }
  );
  return MlGlobalFactor;
}

module.exports = { defineMlGlobalFactor, MlGlobalFactor };
