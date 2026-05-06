const { Model, DataTypes } = require('sequelize');

const RIDE_STATUSES = ['OPEN', 'CLOSED', 'MAINTENANCE'];

class Ride extends Model {}

function defineRide(sequelize) {
  Ride.init(
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
      zoneId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'zone_id',
      },
      status: {
        type: DataTypes.ENUM(...RIDE_STATUSES),
        allowNull: false,
        defaultValue: 'OPEN',
      },
      waitTime: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'wait_time',
      },
      capacityPerHour: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'capacity_per_hour',
      },
      criticality: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
    },
    {
      sequelize,
      modelName: 'Ride',
      tableName: 'rides',
      underscored: true,
    }
  );

  return Ride;
}

module.exports = { defineRide, Ride, RIDE_STATUSES };
