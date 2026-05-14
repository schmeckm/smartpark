const { Model, DataTypes } = require('sequelize');

class ParkAssetPdmRule extends Model {}

/**
 * @param {import('sequelize').Sequelize} sequelize
 */
function defineParkAssetPdmRule(sequelize) {
  ParkAssetPdmRule.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      assetId: { type: DataTypes.UUID, allowNull: false, field: 'asset_id' },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      label: { type: DataTypes.STRING(200), allowNull: true },
      metricName: { type: DataTypes.STRING(160), allowNull: false, field: 'metric_name' },
      warnAbove: { type: DataTypes.DOUBLE, allowNull: true, field: 'warn_above' },
      criticalAbove: { type: DataTypes.DOUBLE, allowNull: true, field: 'critical_above' },
      warnBelow: { type: DataTypes.DOUBLE, allowNull: true, field: 'warn_below' },
      criticalBelow: { type: DataTypes.DOUBLE, allowNull: true, field: 'critical_below' },
      unit: { type: DataTypes.STRING(32), allowNull: true },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'ParkAssetPdmRule',
      tableName: 'park_asset_pdm_rules',
      underscored: true,
      timestamps: true,
    }
  );
  return ParkAssetPdmRule;
}

module.exports = { defineParkAssetPdmRule, ParkAssetPdmRule };
