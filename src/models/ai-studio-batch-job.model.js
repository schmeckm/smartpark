const { Model, DataTypes } = require('sequelize');

class AiStudioBatchJob extends Model {}

function defineAiStudioBatchJob(sequelize) {
  AiStudioBatchJob.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      batchId: { type: DataTypes.UUID, allowNull: false, field: 'batch_id' },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'running' },
      total: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      current: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      currentEntityId: { type: DataTypes.STRING(64), allowNull: true, field: 'current_entity_id' },
      currentEntityLabel: { type: DataTypes.STRING(160), allowNull: true, field: 'current_entity_label' },
      resultsJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'results_json' },
      error: { type: DataTypes.TEXT, allowNull: true },
      startedAt: { type: DataTypes.DATE, allowNull: false, field: 'started_at' },
      finishedAt: { type: DataTypes.DATE, allowNull: true, field: 'finished_at' },
    },
    {
      sequelize,
      modelName: 'AiStudioBatchJob',
      tableName: 'ai_studio_batch_jobs',
      underscored: true,
      timestamps: true,
      updatedAt: 'updated_at',
      createdAt: 'created_at',
    }
  );
  return AiStudioBatchJob;
}

module.exports = { defineAiStudioBatchJob, AiStudioBatchJob };
