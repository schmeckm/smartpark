'use strict';

/** Append-only journey events for process-mining style visitor flow (synthetic or sensor-backed). */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('visitor_journey_events', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      case_id: { type: Sequelize.STRING(160), allowNull: false },
      asset_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'park_assets', key: 'asset_id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      event_type: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'ARRIVAL' },
      occurred_at: { type: Sequelize.DATE, allowNull: false },
      source: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'ingest' },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex('visitor_journey_events', ['park_id', 'occurred_at'], {
      name: 'idx_visitor_journey_events_park_occurred',
    });
    await queryInterface.addIndex('visitor_journey_events', ['park_id', 'case_id', 'occurred_at'], {
      name: 'idx_visitor_journey_events_park_case_occurred',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('visitor_journey_events');
  },
};
