'use strict';

/** Phase 1: hierarchy kinds, Sparkplug flag per node, optional structure lock, ordering. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('uns_nodes', 'entity_kind', {
      type: Sequelize.STRING(40),
      allowNull: true,
    });
    await queryInterface.addColumn('uns_nodes', 'sparkplug_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('uns_nodes', 'is_structure_locked', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('uns_nodes', 'sort_order', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.sequelize.query(`
      UPDATE uns_nodes
      SET entity_kind = 'METRIC', sparkplug_enabled = true
      WHERE is_leaf = true AND topic_path IS NOT NULL AND entity_kind IS NULL
    `);
    await queryInterface.sequelize.query(`
      UPDATE uns_nodes
      SET entity_kind = 'ZONE', sparkplug_enabled = false
      WHERE is_leaf = false AND entity_kind IS NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('uns_nodes', 'sort_order');
    await queryInterface.removeColumn('uns_nodes', 'is_structure_locked');
    await queryInterface.removeColumn('uns_nodes', 'sparkplug_enabled');
    await queryInterface.removeColumn('uns_nodes', 'entity_kind');
  },
};
