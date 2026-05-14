const { Model, DataTypes } = require('sequelize');

class AgentStep extends Model {}

function defineAgentStep(sequelize) {
  AgentStep.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      runId: { type: DataTypes.UUID, allowNull: false, field: 'run_id' },
      stepIndex: { type: DataTypes.INTEGER, allowNull: false, field: 'step_index' },
      stepType: { type: DataTypes.STRING(24), allowNull: false, field: 'step_type' },
      title: { type: DataTypes.STRING(240), allowNull: true },
      detailJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'detail_json' },
    },
    {
      sequelize,
      modelName: 'AgentStep',
      tableName: 'agent_steps',
      underscored: true,
      timestamps: true,
      updatedAt: 'updated_at',
      createdAt: 'created_at',
    }
  );
  return AgentStep;
}

module.exports = { defineAgentStep, AgentStep };
