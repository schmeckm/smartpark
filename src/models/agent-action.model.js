const { Model, DataTypes } = require('sequelize');

class AgentAction extends Model {}

function defineAgentAction(sequelize) {
  AgentAction.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      runId: { type: DataTypes.UUID, allowNull: false, field: 'run_id' },
      stepId: { type: DataTypes.UUID, allowNull: true, field: 'step_id' },
      actionType: { type: DataTypes.STRING(64), allowNull: false, field: 'action_type' },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' },
      payloadJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'payload_json' },
      resultJson: { type: DataTypes.JSONB, allowNull: true, field: 'result_json' },
      expiresAt: { type: DataTypes.DATE, allowNull: true, field: 'expires_at' },
      targetType: { type: DataTypes.STRING(40), allowNull: true, field: 'target_type' },
      targetId: { type: DataTypes.UUID, allowNull: true, field: 'target_id' },
      approvedByUserId: { type: DataTypes.UUID, allowNull: true, field: 'approved_by_user_id' },
      approvedAt: { type: DataTypes.DATE, allowNull: true, field: 'approved_at' },
      rejectedReason: { type: DataTypes.TEXT, allowNull: true, field: 'rejected_reason' },
      /** Phase C — structured outcome / forecast-vs-actual bridge stub (null until resolved). */
      outcomeMetric: { type: DataTypes.JSONB, allowNull: true, field: 'outcome_metric' },
    },
    {
      sequelize,
      modelName: 'AgentAction',
      tableName: 'agent_actions',
      underscored: true,
      timestamps: true,
      updatedAt: 'updated_at',
      createdAt: 'created_at',
    }
  );
  return AgentAction;
}

module.exports = { defineAgentAction, AgentAction };
