const { Model, DataTypes } = require('sequelize');

class ParkAssetPdmEvaluationLog extends Model {}

/**
 * Immutable snapshots of rule-based PdM evaluations (for history / future ML features).
 * @param {import('sequelize').Sequelize} sequelize
 */
function defineParkAssetPdmEvaluationLog(sequelize) {
  ParkAssetPdmEvaluationLog.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      assetId: { type: DataTypes.UUID, allowNull: false, field: 'asset_id' },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      source: { type: DataTypes.STRING(32), allowNull: false },
      evaluatedAt: { type: DataTypes.DATE, allowNull: false, field: 'evaluated_at' },
      riskLevel: { type: DataTypes.STRING(16), allowNull: false, field: 'risk_level' },
      fingerprint: { type: DataTypes.STRING(64), allowNull: false },
      snapshotJson: { type: DataTypes.JSONB, allowNull: false, field: 'snapshot_json' },
    },
    {
      sequelize,
      modelName: 'ParkAssetPdmEvaluationLog',
      tableName: 'park_asset_pdm_evaluation_logs',
      underscored: true,
      timestamps: false,
    }
  );
  return ParkAssetPdmEvaluationLog;
}

module.exports = { defineParkAssetPdmEvaluationLog, ParkAssetPdmEvaluationLog };
