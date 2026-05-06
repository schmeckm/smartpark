'use strict';

/** Phase 5: prepared UNS registry topics (inactive) + operator ride signal capabilities. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('uns_registry_topics', 'is_prepared', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('uns_registry_topics', 'is_active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addIndex('uns_registry_topics', ['registry_entity_id', 'is_prepared'], {
      name: 'uns_registry_topics_entity_prepared_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('uns_registry_topics', 'uns_registry_topics_entity_prepared_idx');
    await queryInterface.removeColumn('uns_registry_topics', 'is_active');
    await queryInterface.removeColumn('uns_registry_topics', 'is_prepared');
  },
};
