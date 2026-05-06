'use strict';

/** Phase 6: pilot activation audit columns + Sparkplug prepared/active flags (registry only; no MQTT / uns_nodes). */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('uns_registry_topics', 'activated_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('uns_registry_topics', 'activated_by', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addColumn('sparkplug_metric_definitions', 'is_prepared', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('sparkplug_metric_definitions', 'is_active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('sparkplug_metric_definitions', 'activated_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('sparkplug_metric_definitions', 'activated_by', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.sequelize.query(`
      UPDATE sparkplug_metric_definitions
      SET is_prepared = true, is_active = false
      WHERE registry_source = 'PREPARED_OPERATOR';
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('sparkplug_metric_definitions', 'activated_by');
    await queryInterface.removeColumn('sparkplug_metric_definitions', 'activated_at');
    await queryInterface.removeColumn('sparkplug_metric_definitions', 'is_active');
    await queryInterface.removeColumn('sparkplug_metric_definitions', 'is_prepared');

    await queryInterface.removeColumn('uns_registry_topics', 'activated_by');
    await queryInterface.removeColumn('uns_registry_topics', 'activated_at');
  },
};
