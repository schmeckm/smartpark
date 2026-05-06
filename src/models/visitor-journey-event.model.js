'use strict';

const { Model, DataTypes } = require('sequelize');

class VisitorJourneyEvent extends Model {}

/**
 * @param {import('sequelize').Sequelize} sequelize
 */
function defineVisitorJourneyEvent(sequelize) {
  VisitorJourneyEvent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      caseId: { type: DataTypes.STRING(160), allowNull: false, field: 'case_id' },
      assetId: { type: DataTypes.UUID, allowNull: false, field: 'asset_id' },
      eventType: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'ARRIVAL', field: 'event_type' },
      occurredAt: { type: DataTypes.DATE, allowNull: false, field: 'occurred_at' },
      source: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'ingest' },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      sequelize,
      modelName: 'VisitorJourneyEvent',
      tableName: 'visitor_journey_events',
      underscored: true,
      timestamps: false,
      updatedAt: false,
    }
  );
  return VisitorJourneyEvent;
}

module.exports = { defineVisitorJourneyEvent, VisitorJourneyEvent };
