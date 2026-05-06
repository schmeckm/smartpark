const { Model, DataTypes } = require('sequelize');

class AssetMlProfileAssignment extends Model {}

function defineAssetMlProfileAssignment(sequelize) {
  AssetMlProfileAssignment.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      assetId: { type: DataTypes.UUID, allowNull: false, field: 'asset_id' },
      profileId: { type: DataTypes.UUID, allowNull: false, field: 'profile_id' },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active_flag' },
      validFrom: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_from' },
      validTo: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_to' },
      assignedBy: { type: DataTypes.UUID, allowNull: true, field: 'assigned_by' },
    },
    {
      sequelize,
      modelName: 'AssetMlProfileAssignment',
      tableName: 'asset_ml_profile_assignments',
      underscored: true,
    }
  );
  return AssetMlProfileAssignment;
}

module.exports = { defineAssetMlProfileAssignment, AssetMlProfileAssignment };
