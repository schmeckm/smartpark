'use strict';

const { Model, DataTypes } = require('sequelize');

const REGISTRY_SOURCE_MIRRORED = 'MIRRORED_FROM_LEGACY';
const REGISTRY_SOURCE_PREPARED_OPERATOR = 'PREPARED_OPERATOR';

class UnsRegistryEntity extends Model {}
class UnsRegistryMapping extends Model {}
class UnsRegistryTopic extends Model {}
class UnsRegistryMetadata extends Model {}
class SignalCatalog extends Model {}
class RideSignalCapability extends Model {}
class SparkplugMetricDefinition extends Model {}

/**
 * @param {import('sequelize').Sequelize} sequelize
 */
function defineUnsRegistryModels(sequelize) {
  UnsRegistryEntity.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      registrySource: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: REGISTRY_SOURCE_MIRRORED,
        field: 'registry_source',
      },
      entityKind: { type: DataTypes.STRING(40), allowNull: false, field: 'entity_kind' },
      legacyTable: { type: DataTypes.STRING(64), allowNull: false, field: 'legacy_table' },
      legacyId: { type: DataTypes.STRING(64), allowNull: false, field: 'legacy_id' },
      parkId: { type: DataTypes.UUID, allowNull: true, field: 'park_id' },
      slug: { type: DataTypes.STRING(200), allowNull: true },
      name: { type: DataTypes.STRING(500), allowNull: true },
      externalEntityId: { type: DataTypes.STRING(255), allowNull: true, field: 'external_entity_id' },
      payloadJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'payload_json' },
      mirroredAt: { type: DataTypes.DATE, allowNull: false, field: 'mirrored_at' },
    },
    {
      sequelize,
      modelName: 'UnsRegistryEntity',
      tableName: 'uns_registry_entities',
      underscored: true,
      timestamps: true,
    }
  );

  UnsRegistryMapping.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      registrySource: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: REGISTRY_SOURCE_MIRRORED,
        field: 'registry_source',
      },
      relationKind: { type: DataTypes.STRING(64), allowNull: false, field: 'relation_kind' },
      fromEntityId: { type: DataTypes.UUID, allowNull: false, field: 'from_entity_id' },
      toEntityId: { type: DataTypes.UUID, allowNull: false, field: 'to_entity_id' },
      payloadJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'payload_json' },
      mirroredAt: { type: DataTypes.DATE, allowNull: false, field: 'mirrored_at' },
    },
    {
      sequelize,
      modelName: 'UnsRegistryMapping',
      tableName: 'uns_registry_mappings',
      underscored: true,
      timestamps: true,
    }
  );

  UnsRegistryTopic.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      registrySource: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: REGISTRY_SOURCE_MIRRORED,
        field: 'registry_source',
      },
      topicPath: { type: DataTypes.STRING(1000), allowNull: false, field: 'topic_path' },
      unsNodeLegacyId: { type: DataTypes.UUID, allowNull: true, field: 'uns_node_legacy_id' },
      parkId: { type: DataTypes.UUID, allowNull: true, field: 'park_id' },
      registryEntityId: { type: DataTypes.UUID, allowNull: true, field: 'registry_entity_id' },
      payloadJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'payload_json' },
      mirroredAt: { type: DataTypes.DATE, allowNull: false, field: 'mirrored_at' },
      isPrepared: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_prepared' },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_active' },
      activatedAt: { type: DataTypes.DATE, allowNull: true, field: 'activated_at' },
      activatedBy: { type: DataTypes.UUID, allowNull: true, field: 'activated_by' },
    },
    {
      sequelize,
      modelName: 'UnsRegistryTopic',
      tableName: 'uns_registry_topics',
      underscored: true,
      timestamps: true,
    }
  );

  UnsRegistryMetadata.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      registrySource: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: REGISTRY_SOURCE_MIRRORED,
        field: 'registry_source',
      },
      registryEntityId: { type: DataTypes.UUID, allowNull: false, field: 'registry_entity_id' },
      metaKey: { type: DataTypes.STRING(255), allowNull: false, field: 'meta_key' },
      metaValueJson: { type: DataTypes.JSONB, allowNull: true, field: 'meta_value_json' },
      mirroredAt: { type: DataTypes.DATE, allowNull: false, field: 'mirrored_at' },
    },
    {
      sequelize,
      modelName: 'UnsRegistryMetadata',
      tableName: 'uns_registry_metadata',
      underscored: true,
      timestamps: true,
    }
  );

  SignalCatalog.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      signalCode: { type: DataTypes.STRING(128), allowNull: false, field: 'signal_code' },
      label: { type: DataTypes.STRING(255), allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      unit: { type: DataTypes.STRING(64), allowNull: true },
      category: { type: DataTypes.STRING(64), allowNull: true },
      registrySource: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: REGISTRY_SOURCE_MIRRORED,
        field: 'registry_source',
      },
      payloadJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'payload_json' },
    },
    {
      sequelize,
      modelName: 'SignalCatalog',
      tableName: 'signal_catalog',
      underscored: true,
      timestamps: true,
    }
  );

  RideSignalCapability.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      assetId: { type: DataTypes.UUID, allowNull: false, field: 'asset_id' },
      signalCatalogId: { type: DataTypes.UUID, allowNull: false, field: 'signal_catalog_id' },
      registrySource: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: REGISTRY_SOURCE_MIRRORED,
        field: 'registry_source',
      },
      capabilityJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'capability_json' },
      mirroredAt: { type: DataTypes.DATE, allowNull: false, field: 'mirrored_at' },
    },
    {
      sequelize,
      modelName: 'RideSignalCapability',
      tableName: 'ride_signal_capabilities',
      underscored: true,
      timestamps: true,
    }
  );

  SparkplugMetricDefinition.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      metricName: { type: DataTypes.STRING(128), allowNull: false, field: 'metric_name' },
      aliasOf: { type: DataTypes.STRING(128), allowNull: true, field: 'alias_of' },
      dataType: { type: DataTypes.STRING(64), allowNull: true, field: 'data_type' },
      description: { type: DataTypes.TEXT, allowNull: true },
      registrySource: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: REGISTRY_SOURCE_MIRRORED,
        field: 'registry_source',
      },
      registryEntityId: { type: DataTypes.UUID, allowNull: true, field: 'registry_entity_id' },
      rideAssetId: { type: DataTypes.UUID, allowNull: true, field: 'ride_asset_id' },
      parkId: { type: DataTypes.UUID, allowNull: true, field: 'park_id' },
      edgeNodeId: { type: DataTypes.STRING(128), allowNull: true, field: 'edge_node_id' },
      deviceId: { type: DataTypes.STRING(128), allowNull: true, field: 'device_id' },
      /** Catalog / UNS signal code; uniqueness for PREPARED_OPERATOR is scoped with park_id + ride_asset_id. */
      signalKey: { type: DataTypes.STRING(128), allowNull: true, field: 'signal_key' },
      isPrepared: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_prepared' },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_active' },
      activatedAt: { type: DataTypes.DATE, allowNull: true, field: 'activated_at' },
      activatedBy: { type: DataTypes.UUID, allowNull: true, field: 'activated_by' },
      payloadJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'payload_json' },
    },
    {
      sequelize,
      modelName: 'SparkplugMetricDefinition',
      tableName: 'sparkplug_metric_definitions',
      underscored: true,
      timestamps: true,
    }
  );

  UnsRegistryEntity.hasMany(UnsRegistryMetadata, { foreignKey: 'registryEntityId', as: 'registryMetadata' });
  UnsRegistryMetadata.belongsTo(UnsRegistryEntity, { foreignKey: 'registryEntityId', as: 'registryEntity' });

  UnsRegistryEntity.hasMany(UnsRegistryTopic, { foreignKey: 'registryEntityId', as: 'registryTopics' });
  UnsRegistryTopic.belongsTo(UnsRegistryEntity, { foreignKey: 'registryEntityId', as: 'registryEntity' });

  UnsRegistryEntity.hasMany(UnsRegistryMapping, { foreignKey: 'fromEntityId', as: 'mappingsFrom' });
  UnsRegistryEntity.hasMany(UnsRegistryMapping, { foreignKey: 'toEntityId', as: 'mappingsTo' });
  UnsRegistryMapping.belongsTo(UnsRegistryEntity, { foreignKey: 'fromEntityId', as: 'fromEntity' });
  UnsRegistryMapping.belongsTo(UnsRegistryEntity, { foreignKey: 'toEntityId', as: 'toEntity' });

  SignalCatalog.hasMany(RideSignalCapability, { foreignKey: 'signalCatalogId', as: 'rideCapabilities' });
  RideSignalCapability.belongsTo(SignalCatalog, { foreignKey: 'signalCatalogId', as: 'signal' });

  return {
    UnsRegistryEntity,
    UnsRegistryMapping,
    UnsRegistryTopic,
    UnsRegistryMetadata,
    SignalCatalog,
    RideSignalCapability,
    SparkplugMetricDefinition,
    REGISTRY_SOURCE_MIRRORED,
    REGISTRY_SOURCE_PREPARED_OPERATOR,
  };
}

module.exports = { defineUnsRegistryModels };
