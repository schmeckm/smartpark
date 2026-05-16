'use strict';

const { Model, DataTypes } = require('sequelize');

class IntegrationNodeRegistry extends Model {}

function defineIntegrationNodeRegistry(sequelize) {
  IntegrationNodeRegistry.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      nodeKey: { type: DataTypes.STRING(80), allowNull: false, unique: true, field: 'node_key' },
      nodeType: { type: DataTypes.STRING(64), allowNull: false, field: 'node_type' },
      displayName: { type: DataTypes.STRING(255), allowNull: false, field: 'display_name' },
      category: { type: DataTypes.STRING(128), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      configSchema: { type: DataTypes.JSONB, allowNull: true, field: 'config_schema' },
      inputSchema: { type: DataTypes.JSONB, allowNull: true, field: 'input_schema' },
      outputSchema: { type: DataTypes.JSONB, allowNull: true, field: 'output_schema' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'IntegrationNodeRegistry',
      tableName: 'integration_node_registry',
      underscored: true,
    }
  );
  return IntegrationNodeRegistry;
}

module.exports = { defineIntegrationNodeRegistry, IntegrationNodeRegistry };
