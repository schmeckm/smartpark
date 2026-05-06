const { Model, DataTypes } = require('sequelize');

class AdapterPackage extends Model {}

function defineAdapterPackage(sequelize) {
  AdapterPackage.init(
    {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      adapterKey: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(200), allowNull: false },
      version: { type: DataTypes.STRING(40), allowNull: false },
      runtime: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'NODE' },
      adapterType: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'PUBLIC_API' },
      sourceType: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'LOCAL_PACKAGE' },
      sourcePath: { type: DataTypes.STRING(500), allowNull: true },
      capabilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      configSchema: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      permissions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'INSTALLED' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      sequelize,
      modelName: 'AdapterPackage',
      tableName: 'adapter_packages',
      underscored: true,
    }
  );
  return AdapterPackage;
}

module.exports = { defineAdapterPackage, AdapterPackage };
