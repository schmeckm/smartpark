'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('crowd_events', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      zone_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'zones', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      event_type: {
        type: Sequelize.ENUM('CROWD_SPIKE', 'CROWD_DROP', 'RIDE_CLOSURE', 'WEATHER_IMPACT'),
        allowNull: false,
      },
      crowd_level: { type: Sequelize.INTEGER, allowNull: false },
      severity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      source: { type: Sequelize.STRING(120), allowNull: false, defaultValue: 'system' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('crowd_events', ['zone_id']);
    await queryInterface.addIndex('crowd_events', ['event_type']);
    await queryInterface.addIndex('crowd_events', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('crowd_events');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_crowd_events_event_type";');
  },
};
