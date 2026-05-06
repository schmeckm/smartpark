'use strict';

/** Phase 13 — MQTT capability guard: persist evaluation on mqtt_inbound_messages (additive). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('mqtt_inbound_messages', 'capability_guard_mode', {
      type: Sequelize.STRING(16),
      allowNull: true,
    });
    await queryInterface.addColumn('mqtt_inbound_messages', 'capability_guard_decision', {
      type: Sequelize.STRING(16),
      allowNull: true,
    });
    await queryInterface.addColumn('mqtt_inbound_messages', 'capability_guard_reason', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn('mqtt_inbound_messages', 'capability_guard_details', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addIndex('mqtt_inbound_messages', ['capability_guard_decision', 'created_at'], {
      name: 'mqtt_inbound_cap_guard_decision_created_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('mqtt_inbound_messages', 'mqtt_inbound_cap_guard_decision_created_idx');
    await queryInterface.removeColumn('mqtt_inbound_messages', 'capability_guard_details');
    await queryInterface.removeColumn('mqtt_inbound_messages', 'capability_guard_reason');
    await queryInterface.removeColumn('mqtt_inbound_messages', 'capability_guard_decision');
    await queryInterface.removeColumn('mqtt_inbound_messages', 'capability_guard_mode');
  },
};
