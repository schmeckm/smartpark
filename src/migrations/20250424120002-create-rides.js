'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('rides', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      name: { type: Sequelize.STRING(160), allowNull: false },
      zone_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'zones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('OPEN', 'CLOSED', 'MAINTENANCE'),
        allowNull: false,
        defaultValue: 'OPEN',
      },
      wait_time: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      capacity_per_hour: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      criticality: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('rides', ['zone_id']);
    await queryInterface.addIndex('rides', ['status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('rides');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_rides_status";');
  },
};
