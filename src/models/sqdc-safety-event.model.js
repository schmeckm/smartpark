const { Model, DataTypes } = require('sequelize');

const SQDC_SAFETY_KINDS = ['near_miss', 'accident'];

class SqdcSafetyEvent extends Model {}

function defineSqdcSafetyEvent(sequelize) {
  SqdcSafetyEvent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      assetId: { type: DataTypes.UUID, allowNull: true, field: 'asset_id' },
      kind: { type: DataTypes.STRING(24), allowNull: false },
      title: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      occurredAt: { type: DataTypes.DATE, allowNull: false, field: 'occurred_at' },
      createdByUserId: { type: DataTypes.UUID, allowNull: false, field: 'created_by_user_id' },
    },
    {
      sequelize,
      modelName: 'SqdcSafetyEvent',
      tableName: 'sqdc_safety_events',
      underscored: true,
      timestamps: true,
    }
  );
  return SqdcSafetyEvent;
}

module.exports = { defineSqdcSafetyEvent, SqdcSafetyEvent, SQDC_SAFETY_KINDS };
