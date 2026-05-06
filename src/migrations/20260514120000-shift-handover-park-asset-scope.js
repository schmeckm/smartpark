'use strict';

/** Schichtübergabe optional pro Park-Objekt (Fahrgeschäft, Restaurant, Show, …). */
module.exports = {
  /** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('shift_handover_entries', 'linked_entity_type', {
      type: Sequelize.STRING(40),
      allowNull: true,
    });
    await queryInterface.addColumn('shift_handover_entries', 'linked_entity_id', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addIndex('shift_handover_entries', ['park_id', 'linked_entity_id'], {
      name: 'idx_shift_handover_park_linked_asset',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('shift_handover_entries', 'idx_shift_handover_park_linked_asset');
    await queryInterface.removeColumn('shift_handover_entries', 'linked_entity_id');
    await queryInterface.removeColumn('shift_handover_entries', 'linked_entity_type');
  },
};
