const { Model, DataTypes } = require('sequelize');

const SQDC_EVENT_TYPES = ['SAFETY', 'QUALITY', 'DELIVERY', 'CUSTOMER', 'PEOPLE', 'MAINTENANCE'];
const SQDC_EVENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const SQDC_EVENT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
const SQDC_EVENT_SOURCES = ['MANUAL', 'MQTT', 'ADAPTER', 'AI', 'SYSTEM'];

class SqdcEvent extends Model {}

function defineSqdcEvent(sequelize) {
  SqdcEvent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      assetId: { type: DataTypes.UUID, allowNull: true, field: 'asset_id' },
      eventType: { type: DataTypes.STRING(32), allowNull: false, field: 'event_type' },
      severity: { type: DataTypes.STRING(16), allowNull: false },
      title: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'OPEN' },
      source: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'MANUAL' },
      eventTime: { type: DataTypes.DATE, allowNull: false, field: 'event_time' },
      resolvedAt: { type: DataTypes.DATE, allowNull: true, field: 'resolved_at' },
      metadataJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'metadata_json' },
    },
    {
      sequelize,
      modelName: 'SqdcEvent',
      tableName: 'sqdc_events',
      underscored: true,
      timestamps: true,
    }
  );
  return SqdcEvent;
}

module.exports = {
  defineSqdcEvent,
  SqdcEvent,
  SQDC_EVENT_TYPES,
  SQDC_EVENT_SEVERITIES,
  SQDC_EVENT_STATUSES,
  SQDC_EVENT_SOURCES,
};
