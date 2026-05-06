'use strict';

const { Model, DataTypes } = require('sequelize');

class MqttInboundMessage extends Model {}
class UnsDiscoveryEvent extends Model {}
class UnsTopicProposal extends Model {}

const SPY_CLASSIFICATION = {
  APPROVED_TOPIC: 'APPROVED_TOPIC',
  UNKNOWN_TOPIC: 'UNKNOWN_TOPIC',
  UNKNOWN_SIGNAL: 'UNKNOWN_SIGNAL',
  CONFLICT: 'CONFLICT',
  OBSERVE_SKIPPED: 'OBSERVE_SKIPPED',
  /** Phase 13 — enforce mode blocked inbound MQTT (capability / registry). */
  CAPABILITY_GUARD_BLOCK: 'CAPABILITY_GUARD_BLOCK',
};

/**
 * @param {import('sequelize').Sequelize} sequelize
 */
function defineUnsSpyModels(sequelize) {
  MqttInboundMessage.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      topic: { type: DataTypes.TEXT, allowNull: false },
      payloadPreview: { type: DataTypes.TEXT, allowNull: true, field: 'payload_preview' },
      payloadLength: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'payload_length' },
      qos: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
      spyClassification: { type: DataTypes.STRING(32), allowNull: true, field: 'spy_classification' },
      spyDetails: { type: DataTypes.JSONB, allowNull: true, field: 'spy_details' },
      capabilityGuardMode: { type: DataTypes.STRING(16), allowNull: true, field: 'capability_guard_mode' },
      capabilityGuardDecision: { type: DataTypes.STRING(16), allowNull: true, field: 'capability_guard_decision' },
      capabilityGuardReason: { type: DataTypes.STRING(255), allowNull: true, field: 'capability_guard_reason' },
      capabilityGuardDetails: { type: DataTypes.JSONB, allowNull: true, field: 'capability_guard_details' },
    },
    {
      sequelize,
      modelName: 'MqttInboundMessage',
      tableName: 'mqtt_inbound_messages',
      underscored: true,
      timestamps: true,
    }
  );

  UnsDiscoveryEvent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      classification: { type: DataTypes.STRING(32), allowNull: false },
      topicPath: { type: DataTypes.TEXT, allowNull: false, field: 'topic_path' },
      mqttInboundMessageId: { type: DataTypes.UUID, allowNull: true, field: 'mqtt_inbound_message_id' },
      details: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      sequelize,
      modelName: 'UnsDiscoveryEvent',
      tableName: 'uns_discovery_events',
      underscored: true,
      timestamps: true,
    }
  );

  UnsTopicProposal.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      discoveryEventId: { type: DataTypes.UUID, allowNull: false, field: 'discovery_event_id' },
      proposedTopic: { type: DataTypes.TEXT, allowNull: false, field: 'proposed_topic' },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' },
      payloadSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'payload_snapshot' },
    },
    {
      sequelize,
      modelName: 'UnsTopicProposal',
      tableName: 'uns_topic_proposals',
      underscored: true,
      timestamps: true,
    }
  );

  MqttInboundMessage.hasMany(UnsDiscoveryEvent, { foreignKey: 'mqttInboundMessageId', as: 'discoveryEvents' });
  UnsDiscoveryEvent.belongsTo(MqttInboundMessage, { foreignKey: 'mqttInboundMessageId', as: 'mqttInboundMessage' });

  UnsDiscoveryEvent.hasMany(UnsTopicProposal, { foreignKey: 'discoveryEventId', as: 'topicProposals' });
  UnsTopicProposal.belongsTo(UnsDiscoveryEvent, { foreignKey: 'discoveryEventId', as: 'discoveryEvent' });

  return {
    MqttInboundMessage,
    UnsDiscoveryEvent,
    UnsTopicProposal,
    SPY_CLASSIFICATION,
  };
}

module.exports = { defineUnsSpyModels, SPY_CLASSIFICATION };
