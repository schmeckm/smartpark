const { Model, DataTypes } = require('sequelize');

const ZONE_STATUSES = ['ACTIVE', 'LIMITED', 'CLOSED', 'EVACUATION'];

class Zone extends Model {}

function defineZone(sequelize) {
  Zone.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      currentCrowdLevel: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'current_crowd_level',
      },
      forecastCrowdLevel: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'forecast_crowd_level',
      },
      maxCapacity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'max_capacity',
      },
      status: {
        type: DataTypes.ENUM(...ZONE_STATUSES),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      adjacentZoneIds: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        field: 'adjacent_zone_ids',
      },
    },
    {
      sequelize,
      modelName: 'Zone',
      tableName: 'zones',
      underscored: true,
    }
  );

  return Zone;
}

module.exports = { defineZone, Zone, ZONE_STATUSES };
