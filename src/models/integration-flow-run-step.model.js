'use strict';

const { Model, DataTypes } = require('sequelize');

const STEP_STATUSES = ['pending', 'running', 'success', 'failed', 'skipped'];

class IntegrationFlowRunStep extends Model {}

function defineIntegrationFlowRunStep(sequelize) {
  IntegrationFlowRunStep.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      runId: { type: DataTypes.UUID, allowNull: false, field: 'run_id' },
      nodeId: { type: DataTypes.STRING(128), allowNull: false, field: 'node_id' },
      nodeType: { type: DataTypes.STRING(80), allowNull: false, field: 'node_type' },
      status: { type: DataTypes.STRING(32), allowNull: false },
      startedAt: { type: DataTypes.DATE, allowNull: true, field: 'started_at' },
      finishedAt: { type: DataTypes.DATE, allowNull: true, field: 'finished_at' },
      durationMs: { type: DataTypes.INTEGER, allowNull: true, field: 'duration_ms' },
      inputJson: { type: DataTypes.JSONB, allowNull: true, field: 'input_json' },
      outputJson: { type: DataTypes.JSONB, allowNull: true, field: 'output_json' },
      previewInputJson: { type: DataTypes.JSONB, allowNull: true, field: 'preview_input_json' },
      previewOutputJson: { type: DataTypes.JSONB, allowNull: true, field: 'preview_output_json' },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
    },
    {
      sequelize,
      modelName: 'IntegrationFlowRunStep',
      tableName: 'integration_flow_run_steps',
      underscored: true,
    }
  );
  return IntegrationFlowRunStep;
}

module.exports = { defineIntegrationFlowRunStep, IntegrationFlowRunStep, STEP_STATUSES };
