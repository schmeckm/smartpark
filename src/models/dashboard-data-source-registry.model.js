'use strict';

const { Model, DataTypes } = require('sequelize');

class DashboardDataSourceRegistry extends Model {}

function defineDashboardDataSourceRegistry(sequelize) {
  DashboardDataSourceRegistry.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      dataSourceKey: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        field: 'data_source_key',
      },
      displayName: { type: DataTypes.STRING(255), allowNull: false, field: 'display_name' },
      category: { type: DataTypes.STRING(128), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      sourceType: { type: DataTypes.STRING(64), allowNull: false, field: 'source_type' },
      endpoint: { type: DataTypes.STRING(512), allowNull: true },
      refreshSeconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60, field: 'refresh_seconds' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'DashboardDataSourceRegistry',
      tableName: 'dashboard_data_source_registry',
      underscored: true,
    }
  );
  return DashboardDataSourceRegistry;
}

module.exports = { DashboardDataSourceRegistry, defineDashboardDataSourceRegistry };
