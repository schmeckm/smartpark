'use strict';

/** Phase 4: observe-only UNS Spy + raw MQTT inbound log. No changes to uns_nodes / uns_latest_states. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('mqtt_inbound_messages', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      topic: { type: Sequelize.TEXT, allowNull: false },
      payload_preview: { type: Sequelize.TEXT, allowNull: true },
      payload_length: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      qos: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 },
      spy_classification: { type: Sequelize.STRING(32), allowNull: true },
      spy_details: { type: Sequelize.JSONB, allowNull: true, defaultValue: null },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('mqtt_inbound_messages', ['created_at'], {
      name: 'mqtt_inbound_messages_created_idx',
    });
    await queryInterface.addIndex('mqtt_inbound_messages', ['spy_classification', 'created_at'], {
      name: 'mqtt_inbound_messages_spy_class_created_idx',
    });

    await queryInterface.createTable('uns_discovery_events', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      classification: { type: Sequelize.STRING(32), allowNull: false },
      topic_path: { type: Sequelize.TEXT, allowNull: false },
      mqtt_inbound_message_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'mqtt_inbound_messages', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      details: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('uns_discovery_events', ['classification', 'created_at'], {
      name: 'uns_discovery_events_class_created_idx',
    });
    await queryInterface.addIndex('uns_discovery_events', ['topic_path'], {
      name: 'uns_discovery_events_topic_path_idx',
    });

    await queryInterface.createTable('uns_topic_proposals', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      discovery_event_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'uns_discovery_events', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      proposed_topic: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'pending' },
      payload_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('uns_topic_proposals', ['discovery_event_id'], {
      name: 'uns_topic_proposals_discovery_idx',
    });
    await queryInterface.addIndex('uns_topic_proposals', ['status', 'created_at'], {
      name: 'uns_topic_proposals_status_created_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('uns_topic_proposals');
    await queryInterface.dropTable('uns_discovery_events');
    await queryInterface.dropTable('mqtt_inbound_messages');
  },
};
