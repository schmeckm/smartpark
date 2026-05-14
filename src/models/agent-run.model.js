const { Model, DataTypes } = require('sequelize');

class AgentRun extends Model {}

function defineAgentRun(sequelize) {
  AgentRun.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      skillId: { type: DataTypes.STRING(64), allowNull: false, field: 'skill_id' },
      mode: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'auto' },
      triggerType: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'manual', field: 'trigger_type' },
      triggerRef: { type: DataTypes.STRING(128), allowNull: true, field: 'trigger_ref' },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'running' },
      startedAt: { type: DataTypes.DATE, allowNull: false, field: 'started_at' },
      finishedAt: { type: DataTypes.DATE, allowNull: true, field: 'finished_at' },
      inputJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'input_json' },
      outputSummary: { type: DataTypes.TEXT, allowNull: true, field: 'output_summary' },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
      metaJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'meta_json' },
      createdByUserId: { type: DataTypes.UUID, allowNull: true, field: 'created_by_user_id' },
    },
    {
      sequelize,
      modelName: 'AgentRun',
      tableName: 'agent_runs',
      underscored: true,
      timestamps: true,
      updatedAt: 'updated_at',
      createdAt: 'created_at',
    }
  );
  return AgentRun;
}

module.exports = { defineAgentRun, AgentRun };
