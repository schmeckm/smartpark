const { Model, DataTypes } = require('sequelize');

const MAPPING_STATUSES = ['UNMAPPED', 'MAPPED', 'IGNORED', 'NEEDS_REVIEW'];

class ExternalEntityMapping extends Model {}

function defineExternalEntityMapping(sequelize) {
  ExternalEntityMapping.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      provider: { type: DataTypes.STRING(64), allowNull: false },
      externalDestinationId: { type: DataTypes.STRING(255), allowNull: true, field: 'external_destination_id' },
      externalParkId: { type: DataTypes.STRING(255), allowNull: true, field: 'external_park_id' },
      externalEntityId: { type: DataTypes.STRING(255), allowNull: false, field: 'external_entity_id' },
      externalEntityName: { type: DataTypes.STRING(255), allowNull: false, field: 'external_entity_name' },
      externalEntityType: { type: DataTypes.STRING(80), allowNull: false, field: 'external_entity_type' },
      internalEntityType: { type: DataTypes.STRING(80), allowNull: true, field: 'internal_entity_type' },
      internalEntityId: { type: DataTypes.UUID, allowNull: true, field: 'internal_entity_id' },
      mappingStatus: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'UNMAPPED', field: 'mapping_status' },
      confidence: { type: DataTypes.DECIMAL(8, 6), allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      sequelize,
      modelName: 'ExternalEntityMapping',
      tableName: 'external_entity_mappings',
      underscored: true,
    }
  );

  return ExternalEntityMapping;
}

module.exports = { defineExternalEntityMapping, ExternalEntityMapping, MAPPING_STATUSES };
