const { Model, DataTypes } = require('sequelize');

const CANONICAL_MESSAGE_TYPES = [
  'DESTINATION_SYNCED',
  'PARK_SYNCED',
  'PARK_ENTITY_SYNCED',
  'WAIT_TIME_UPDATED',
  'ENTITY_STATUS_UPDATED',
  'PARK_OPERATING_HOURS_UPDATED',
  'PARK_CROWD_LEVEL_UPDATED',
  'WEATHER_OBSERVATION_UPDATED',
  'CALENDAR_CONTEXT_UPDATED',
];

const CANONICAL_MESSAGE_STATUSES = ['RECEIVED', 'VALIDATED', 'APPLIED', 'FAILED', 'IGNORED'];

class CanonicalInboundMessage extends Model {}

function defineCanonicalInboundMessage(sequelize) {
  CanonicalInboundMessage.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      messageType: { type: DataTypes.STRING(80), allowNull: false, field: 'message_type' },
      provider: { type: DataTypes.STRING(64), allowNull: false },
      providerMessageId: { type: DataTypes.STRING(255), allowNull: true, field: 'provider_message_id' },
      externalDestinationId: { type: DataTypes.STRING(255), allowNull: true, field: 'external_destination_id' },
      externalParkId: { type: DataTypes.STRING(255), allowNull: true, field: 'external_park_id' },
      externalEntityId: { type: DataTypes.STRING(255), allowNull: true, field: 'external_entity_id' },
      entityType: { type: DataTypes.STRING(80), allowNull: true, field: 'entity_type' },
      occurredAt: { type: DataTypes.DATE, allowNull: false, field: 'occurred_at' },
      receivedAt: { type: DataTypes.DATE, allowNull: false, field: 'received_at' },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      rawPayload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'raw_payload' },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'RECEIVED' },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
    },
    {
      sequelize,
      modelName: 'CanonicalInboundMessage',
      tableName: 'canonical_inbound_messages',
      underscored: true,
    }
  );

  return CanonicalInboundMessage;
}

module.exports = {
  defineCanonicalInboundMessage,
  CanonicalInboundMessage,
  CANONICAL_MESSAGE_TYPES,
  CANONICAL_MESSAGE_STATUSES,
};
