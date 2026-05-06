const { Model, DataTypes } = require('sequelize');

class AssetMlOverride extends Model {}

function defineAssetMlOverride(sequelize) {
  AssetMlOverride.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      assetId: { type: DataTypes.UUID, allowNull: false, field: 'asset_id' },
      overrideKey: { type: DataTypes.STRING(120), allowNull: false, field: 'override_key' },
      overrideValueJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'override_value_json' },
      overrideReason: { type: DataTypes.TEXT, allowNull: true, field: 'override_reason' },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active_flag' },
    },
    {
      sequelize,
      modelName: 'AssetMlOverride',
      tableName: 'asset_ml_overrides',
      underscored: true,
    }
  );
  return AssetMlOverride;
}

module.exports = { defineAssetMlOverride, AssetMlOverride };
