'use strict';

const { Model, DataTypes } = require('sequelize');

class IntegrationFlowDefinition extends Model {}

function defineIntegrationFlowDefinition(sequelize) {
  IntegrationFlowDefinition.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: true, field: 'park_id' },
      name: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      triggerType: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'MANUAL', field: 'trigger_type' },
      flowJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'flow_json' },
      scheduleEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'schedule_enabled' },
      scheduleIntervalSeconds: { type: DataTypes.INTEGER, allowNull: true, field: 'schedule_interval_seconds' },
      lastScheduledRunAt: { type: DataTypes.DATE, allowNull: true, field: 'last_scheduled_run_at' },
      nextScheduledRunAt: { type: DataTypes.DATE, allowNull: true, field: 'next_scheduled_run_at' },
      scheduleLockUntil: { type: DataTypes.DATE, allowNull: true, field: 'schedule_lock_until' },
      retryEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'retry_enabled' },
      maxRetryAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'max_retry_attempts' },
      retryDelaySeconds: { type: DataTypes.INTEGER, allowNull: true, field: 'retry_delay_seconds' },
      retryOnNodeTypes: { type: DataTypes.JSONB, allowNull: true, field: 'retry_on_node_types' },
      createdBy: { type: DataTypes.STRING(255), allowNull: true, field: 'created_by' },
      updatedBy: { type: DataTypes.STRING(255), allowNull: true, field: 'updated_by' },
    },
    {
      sequelize,
      modelName: 'IntegrationFlowDefinition',
      tableName: 'integration_flow_definitions',
      underscored: true,
    }
  );
  return IntegrationFlowDefinition;
}

module.exports = { defineIntegrationFlowDefinition, IntegrationFlowDefinition };
