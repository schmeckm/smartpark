const { DataTypes, Model } = require('sequelize');

class ForecastSnapshot extends Model {}

function defineForecastSnapshot(sequelize) {
  ForecastSnapshot.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      snapshotTime: { type: DataTypes.DATE, allowNull: false, field: 'snapshot_time' },
      crowdIndex: { type: DataTypes.FLOAT, allowNull: true, field: 'crowd_index' },
      inboundIndex: { type: DataTypes.FLOAT, allowNull: true, field: 'inbound_index' },
      avgQueueTime: { type: DataTypes.FLOAT, allowNull: true, field: 'avg_queue_time' },
      trafficPressureIndex: { type: DataTypes.FLOAT, allowNull: true, field: 'traffic_pressure_index' },
      openRidesCount: { type: DataTypes.INTEGER, allowNull: true, field: 'open_rides_count' },
      closedRidesCount: { type: DataTypes.INTEGER, allowNull: true, field: 'closed_rides_count' },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'ForecastSnapshot',
      tableName: 'forecast_snapshots',
      underscored: true,
      freezeTableName: true,
      updatedAt: false,
    }
  );
  return ForecastSnapshot;
}

module.exports = { ForecastSnapshot, defineForecastSnapshot };
