'use strict';

const { Model, DataTypes } = require('sequelize');

class RegistryPublishEvent extends Model {}

function defineRegistryPublishEvent(sequelize) {
  RegistryPublishEvent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      rideAssetId: { type: DataTypes.UUID, allowNull: false, field: 'ride_asset_id' },
      registryTopicId: { type: DataTypes.UUID, allowNull: true, field: 'registry_topic_id' },
      sparkplugMetricDefinitionId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'sparkplug_metric_definition_id',
      },
      topic: { type: DataTypes.TEXT, allowNull: false },
      payloadPreview: { type: DataTypes.TEXT, allowNull: true, field: 'payload_preview' },
      publishMode: { type: DataTypes.STRING(32), allowNull: false, field: 'publish_mode' },
      publishFormat: { type: DataTypes.STRING(32), allowNull: false, field: 'publish_format' },
      status: { type: DataTypes.STRING(32), allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: true },
      publishedAt: { type: DataTypes.DATE, allowNull: true, field: 'published_at' },
    },
    {
      sequelize,
      modelName: 'RegistryPublishEvent',
      tableName: 'registry_publish_events',
      underscored: true,
      timestamps: true,
    }
  );
  return RegistryPublishEvent;
}

module.exports = { defineRegistryPublishEvent, RegistryPublishEvent };
