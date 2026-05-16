const { Model, DataTypes } = require('sequelize');

class TrafficProviderConfig extends Model {}

function defineTrafficProviderConfig(sequelize) {
  TrafficProviderConfig.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      providerKey: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'provider_key' },
      displayName: { type: DataTypes.STRING(200), allowNull: false, field: 'display_name' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      encryptedApiKey: { type: DataTypes.TEXT, allowNull: true, field: 'encrypted_api_key' },
      apiKeySuffix: { type: DataTypes.STRING(8), allowNull: true, field: 'api_key_suffix' },
      pollIntervalMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10, field: 'poll_interval_minutes' },
      timeoutMs: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 15000, field: 'timeout_ms' },
      baseUrl: { type: DataTypes.STRING(500), allowNull: false, field: 'base_url' },
      createdByUserId: { type: DataTypes.UUID, allowNull: true, field: 'created_by_user_id' },
      updatedByUserId: { type: DataTypes.UUID, allowNull: true, field: 'updated_by_user_id' },
    },
    {
      sequelize,
      modelName: 'TrafficProviderConfig',
      tableName: 'traffic_provider_configs',
      underscored: true,
      timestamps: true,
    }
  );
  return TrafficProviderConfig;
}

module.exports = { defineTrafficProviderConfig, TrafficProviderConfig };
