const { Model, DataTypes } = require('sequelize');

class UnsDevice extends Model {}

function defineUnsDevice(sequelize) {
  UnsDevice.init(
    {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      parkId: { type: DataTypes.STRING(255), allowNull: false },
      name: { type: DataTypes.STRING(200), allowNull: false },
      deviceType: { type: DataTypes.STRING(80), allowNull: false },
      deviceKey: { type: DataTypes.STRING(200), allowNull: false, unique: true },
      assignedNodeId: { type: DataTypes.UUID, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'UnsDevice',
      tableName: 'uns_devices',
      underscored: true,
    }
  );
  return UnsDevice;
}

module.exports = { defineUnsDevice, UnsDevice };
