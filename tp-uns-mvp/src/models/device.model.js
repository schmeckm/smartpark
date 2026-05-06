const { DataTypes, Model } = require('sequelize');

class Device extends Model {}

function defineDevice(sequelize) {
  Device.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      name: { type: DataTypes.STRING(120), allowNull: false },
      deviceType: {
        type: DataTypes.ENUM('CAMERA', 'SENSOR', 'API_ADAPTER', 'FORECAST_SERVICE', 'EDGE_NODE'),
        allowNull: false,
        field: 'device_type',
      },
      deviceKey: { type: DataTypes.STRING(120), allowNull: false, unique: true, field: 'device_key' },
      locationDescription: { type: DataTypes.STRING(255), allowNull: true, field: 'location_description' },
      assignedNodeId: { type: DataTypes.UUID, allowNull: true, field: 'assigned_node_id' },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    },
    { sequelize, modelName: 'Device', tableName: 'devices', underscored: true, freezeTableName: true }
  );
  return Device;
}

module.exports = { Device, defineDevice };
