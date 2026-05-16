'use strict';

const { Model, DataTypes } = require('sequelize');

class DashboardWidgetInstance extends Model {}

function defineDashboardWidgetInstance(sequelize) {
  DashboardWidgetInstance.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      widgetKey: { type: DataTypes.STRING(128), allowNull: false, field: 'widget_key' },
      title: { type: DataTypes.STRING(255), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      widgetConfig: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'widget_config' },
      dataSourceKey: { type: DataTypes.STRING(128), allowNull: true, field: 'data_source_key' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: { type: DataTypes.STRING(255), allowNull: true, field: 'created_by' },
      updatedBy: { type: DataTypes.STRING(255), allowNull: true, field: 'updated_by' },
    },
    {
      sequelize,
      modelName: 'DashboardWidgetInstance',
      tableName: 'dashboard_widget_instances',
      underscored: true,
    }
  );
  return DashboardWidgetInstance;
}

module.exports = { DashboardWidgetInstance, defineDashboardWidgetInstance };
