'use strict';

const { Model, DataTypes } = require('sequelize');

const RUN_STATUSES = ['pending', 'running', 'success', 'failed'];

class IntegrationFlowRun extends Model {}

function defineIntegrationFlowRun(sequelize) {
  IntegrationFlowRun.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      flowId: { type: DataTypes.UUID, allowNull: true, field: 'flow_id' },
      status: { type: DataTypes.STRING(32), allowNull: false },
      startedAt: { type: DataTypes.DATE, allowNull: true, field: 'started_at' },
      finishedAt: { type: DataTypes.DATE, allowNull: true, field: 'finished_at' },
      durationMs: { type: DataTypes.INTEGER, allowNull: true, field: 'duration_ms' },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
      inputJson: { type: DataTypes.JSONB, allowNull: true, field: 'input_json' },
      outputJson: { type: DataTypes.JSONB, allowNull: true, field: 'output_json' },
      parentRunId: { type: DataTypes.UUID, allowNull: true, field: 'parent_run_id' },
      retryAttempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'retry_attempt' },
      retryOfRunId: { type: DataTypes.UUID, allowNull: true, field: 'retry_of_run_id' },
      nextRetryAt: { type: DataTypes.DATE, allowNull: true, field: 'next_retry_at' },
      retryStatus: { type: DataTypes.STRING(32), allowNull: true, field: 'retry_status' },
      retryLockUntil: { type: DataTypes.DATE, allowNull: true, field: 'retry_lock_until' },
      acknowledgedAt: { type: DataTypes.DATE, allowNull: true, field: 'acknowledged_at' },
      acknowledgedBy: { type: DataTypes.STRING(255), allowNull: true, field: 'acknowledged_by' },
      acknowledgementNote: { type: DataTypes.TEXT, allowNull: true, field: 'acknowledgement_note' },
    },
    {
      sequelize,
      modelName: 'IntegrationFlowRun',
      tableName: 'integration_flow_runs',
      underscored: true,
    }
  );
  return IntegrationFlowRun;
}

module.exports = { defineIntegrationFlowRun, IntegrationFlowRun, RUN_STATUSES };
