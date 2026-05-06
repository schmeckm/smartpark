const { Model, DataTypes } = require('sequelize');

class SqdcDailySnapshot extends Model {}

function defineSqdcDailySnapshot(sequelize) {
  SqdcDailySnapshot.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      assetId: { type: DataTypes.UUID, allowNull: true, field: 'asset_id' },
      snapshotDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'snapshot_date' },
      level: { type: DataTypes.STRING(16), allowNull: false },
      safetyScore: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'safety_score' },
      qualityScore: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'quality_score' },
      deliveryScore: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'delivery_score' },
      customerScore: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'customer_score' },
      overallScore: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'overall_score' },
      safetyJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'safety_json' },
      qualityJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'quality_json' },
      deliveryJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'delivery_json' },
      customerJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'customer_json' },
      aiRecommendationsJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'ai_recommendations_json' },
    },
    {
      sequelize,
      modelName: 'SqdcDailySnapshot',
      tableName: 'sqdc_daily_snapshots',
      underscored: true,
      timestamps: true,
    }
  );
  return SqdcDailySnapshot;
}

module.exports = { defineSqdcDailySnapshot, SqdcDailySnapshot };
