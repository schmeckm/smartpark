'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('recommendations', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      event_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'crowd_events', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      recommendation_type: {
        type: Sequelize.ENUM(
          'REALLOCATE_STAFF',
          'OPEN_SERVICE_POINT',
          'SEND_SECURITY',
          'CLEANING_SUPPORT',
          'GUEST_ROUTING'
        ),
        allowNull: false,
      },
      priority: {
        type: Sequelize.ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
        allowNull: false,
        defaultValue: 'MEDIUM',
      },
      message: { type: Sequelize.TEXT, allowNull: false },
      status: {
        type: Sequelize.ENUM('OPEN', 'ACCEPTED', 'REJECTED', 'COMPLETED'),
        allowNull: false,
        defaultValue: 'OPEN',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('recommendations', ['event_id']);
    await queryInterface.addIndex('recommendations', ['status']);
    await queryInterface.addIndex('recommendations', ['recommendation_type']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('recommendations');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_recommendations_recommendation_type";'
    );
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_recommendations_priority";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_recommendations_status";');
  },
};
