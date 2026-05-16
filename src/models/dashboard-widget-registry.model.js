'use strict';

const { Model, DataTypes } = require('sequelize');

class DashboardWidgetRegistry extends Model {}

function defineDashboardWidgetRegistry(sequelize) {
  DashboardWidgetRegistry.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      widgetKey: { type: DataTypes.STRING(128), allowNull: false, unique: true, field: 'widget_key' },
      displayName: { type: DataTypes.STRING(255), allowNull: false, field: 'display_name' },
      category: { type: DataTypes.STRING(128), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      componentName: { type: DataTypes.STRING(128), allowNull: false, field: 'component_name' },
      configSchema: { type: DataTypes.JSONB, allowNull: true, field: 'config_schema' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'DashboardWidgetRegistry',
      tableName: 'dashboard_widget_registry',
      underscored: true,
    }
  );
  return DashboardWidgetRegistry;
}

module.exports = { DashboardWidgetRegistry, defineDashboardWidgetRegistry };
