'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('staff', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      first_name: { type: Sequelize.STRING(80), allowNull: false },
      last_name: { type: Sequelize.STRING(80), allowNull: false },
      role: {
        type: Sequelize.ENUM(
          'FOOD_SERVICE',
          'RIDE_OPERATOR',
          'CLEANING',
          'SECURITY',
          'GUEST_SERVICE'
        ),
        allowNull: false,
      },
      current_zone_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'zones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      available: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      skill_level: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('staff', ['current_zone_id']);
    await queryInterface.addIndex('staff', ['role']);
    await queryInterface.addIndex('staff', ['available']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('staff');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_staff_role";');
  },
};
