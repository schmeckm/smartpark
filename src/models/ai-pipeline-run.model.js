const { Model, DataTypes } = require('sequelize');

class AiPipelineRun extends Model {}

function defineAiPipelineRun(sequelize) {
  AiPipelineRun.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      startedAt: { type: DataTypes.DATE, allowNull: false, field: 'started_at' },
      finishedAt: { type: DataTypes.DATE, allowNull: true, field: 'finished_at' },
      durationMs: { type: DataTypes.INTEGER, allowNull: true, field: 'duration_ms' },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'running' },
      parkSnapshotsWritten: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'park_snapshots_written' },
      rideSnapshotsWritten: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'ride_snapshots_written' },
      labelsWritten: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'labels_written' },
      featureStoreError: { type: DataTypes.TEXT, allowNull: true, field: 'feature_store_error' },
      scoringError: { type: DataTypes.TEXT, allowNull: true, field: 'scoring_error' },
      parkId: { type: DataTypes.UUID, allowNull: true, field: 'park_id' },
    },
    {
      sequelize,
      modelName: 'AiPipelineRun',
      tableName: 'ai_pipeline_runs',
      underscored: true,
      timestamps: true,
      updatedAt: 'updated_at',
      createdAt: 'created_at',
    }
  );
  return AiPipelineRun;
}

module.exports = { defineAiPipelineRun, AiPipelineRun };
