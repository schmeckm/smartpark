const { Model, DataTypes } = require('sequelize');

class ParkOperatingSnapshot extends Model {}

function defineParkOperatingSnapshot(sequelize) {
  ParkOperatingSnapshot.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      provider: { type: DataTypes.STRING(64), allowNull: false },
      externalDestinationId: { type: DataTypes.STRING(255), allowNull: true, field: 'external_destination_id' },
      externalParkId: { type: DataTypes.STRING(255), allowNull: false, field: 'external_park_id' },
      openingTimes: { type: DataTypes.JSONB, allowNull: true, field: 'opening_times' },
      crowdLevel: { type: DataTypes.JSONB, allowNull: true, field: 'crowd_level' },
      rawPayload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'raw_payload' },
      sampledAt: { type: DataTypes.DATE, allowNull: false, field: 'sampled_at' },
      createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'ParkOperatingSnapshot',
      tableName: 'park_operating_snapshots',
      underscored: true,
      updatedAt: false,
    }
  );
  return ParkOperatingSnapshot;
}

module.exports = { defineParkOperatingSnapshot, ParkOperatingSnapshot };
