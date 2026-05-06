'use strict';

/** Phase 8: audit log for registry-based MQTT publisher pilot (additive; no legacy pipeline changes). */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('registry_publish_events', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      ride_asset_id: { type: Sequelize.UUID, allowNull: false },
      registry_topic_id: { type: Sequelize.UUID, allowNull: true },
      sparkplug_metric_definition_id: { type: Sequelize.UUID, allowNull: true },
      topic: { type: Sequelize.TEXT, allowNull: false },
      payload_preview: { type: Sequelize.TEXT, allowNull: true },
      publish_mode: { type: Sequelize.STRING(32), allowNull: false },
      publish_format: { type: Sequelize.STRING(32), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false },
      reason: { type: Sequelize.TEXT, allowNull: true },
      published_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex('registry_publish_events', ['ride_asset_id'], {
      name: 'registry_publish_events_ride_asset_idx',
    });
    await queryInterface.addIndex('registry_publish_events', ['created_at'], {
      name: 'registry_publish_events_created_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('registry_publish_events');
  },
};
