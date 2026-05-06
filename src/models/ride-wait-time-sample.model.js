const { Model, DataTypes } = require('sequelize');

class RideWaitTimeSample extends Model {}

function defineRideWaitTimeSample(sequelize) {
  RideWaitTimeSample.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      provider: { type: DataTypes.STRING(64), allowNull: false },
      externalParkId: { type: DataTypes.STRING(255), allowNull: false, field: 'external_park_id' },
      externalEntityId: { type: DataTypes.STRING(255), allowNull: false, field: 'external_entity_id' },
      externalEntityName: { type: DataTypes.STRING(255), allowNull: true, field: 'external_entity_name' },
      internalRideId: { type: DataTypes.UUID, allowNull: true, field: 'internal_ride_id' },
      parkAssetId: { type: DataTypes.UUID, allowNull: true, field: 'park_asset_id' },
      waitTime: { type: DataTypes.INTEGER, allowNull: true, field: 'wait_time' },
      status: { type: DataTypes.STRING(80), allowNull: true },
      isOpen: { type: DataTypes.BOOLEAN, allowNull: true, field: 'is_open' },
      rawPayload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'raw_payload' },
      sampledAt: { type: DataTypes.DATE, allowNull: false, field: 'sampled_at' },
      createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'RideWaitTimeSample',
      tableName: 'ride_wait_time_samples',
      underscored: true,
      updatedAt: false,
    }
  );
  return RideWaitTimeSample;
}

module.exports = { defineRideWaitTimeSample, RideWaitTimeSample };
