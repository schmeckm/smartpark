const { Model, DataTypes } = require('sequelize');

class ProviderAdapterConfig extends Model {}

function defineProviderAdapterConfig(sequelize) {
  ProviderAdapterConfig.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      provider: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      baseUrl: { type: DataTypes.STRING(500), allowNull: false, field: 'base_url' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      capabilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      authConfig: { type: DataTypes.JSONB, allowNull: true, field: 'auth_config' },
      rateLimitConfig: { type: DataTypes.JSONB, allowNull: true, field: 'rate_limit_config' },
      pollingConfig: { type: DataTypes.JSONB, allowNull: true, field: 'polling_config' },
      mappingConfig: { type: DataTypes.JSONB, allowNull: true, field: 'mapping_config' },
    },
    {
      sequelize,
      modelName: 'ProviderAdapterConfig',
      tableName: 'provider_adapter_configs',
      underscored: true,
    }
  );
  return ProviderAdapterConfig;
}

module.exports = { defineProviderAdapterConfig, ProviderAdapterConfig };
