const { DataTypes, Model } = require('sequelize');

class CanonicalEvent extends Model {}

function defineCanonicalEvent(sequelize) {
  CanonicalEvent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      topicPath: { type: DataTypes.STRING(255), allowNull: false, field: 'topic_path' },
      eventType: { type: DataTypes.STRING(80), allowNull: false, field: 'event_type' },
      eventTime: { type: DataTypes.DATE, allowNull: false, field: 'event_time' },
      source: { type: DataTypes.STRING(120), allowNull: true },
      quality: { type: DataTypes.STRING(16), allowNull: true },
      confidence: { type: DataTypes.FLOAT, allowNull: true },
      payloadJson: { type: DataTypes.JSONB, allowNull: false, field: 'payload_json' },
    },
    {
      sequelize,
      modelName: 'CanonicalEvent',
      tableName: 'canonical_events',
      underscored: true,
      freezeTableName: true,
    }
  );
  return CanonicalEvent;
}

module.exports = { CanonicalEvent, defineCanonicalEvent };
