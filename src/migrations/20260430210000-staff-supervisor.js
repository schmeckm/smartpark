'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('staff', 'supervisor_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'staff', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('staff', ['supervisor_id']);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('staff', ['supervisor_id']);
    await queryInterface.removeColumn('staff', 'supervisor_id');
  },
};
