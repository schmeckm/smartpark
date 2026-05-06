'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('zones', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      name: { type: Sequelize.STRING(160), allowNull: false },
      type: { type: Sequelize.STRING(80), allowNull: false },
      current_crowd_level: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      forecast_crowd_level: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      max_capacity: { type: Sequelize.INTEGER, allowNull: false },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'LIMITED', 'CLOSED', 'EVACUATION'),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      adjacent_zone_ids: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('zones', ['status']);
    await queryInterface.addIndex('zones', ['type']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('zones');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_zones_status";');
  },
};
