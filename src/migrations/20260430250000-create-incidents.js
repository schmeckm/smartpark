'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('incidents', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'),
        allowNull: false,
        defaultValue: 'OPEN',
      },
      severity: {
        type: Sequelize.ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
        allowNull: false,
        defaultValue: 'MEDIUM',
      },
      title: { type: Sequelize.STRING(200), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      owner_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_by_user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      linked_entity_type: { type: Sequelize.STRING(40), allowNull: true },
      linked_entity_id: { type: Sequelize.STRING(64), allowNull: true },
      sla_due_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex('incidents', ['park_id']);
    await queryInterface.addIndex('incidents', ['status']);
    await queryInterface.addIndex('incidents', ['created_at']);
    await queryInterface.addIndex('incidents', ['owner_user_id']);
    await queryInterface.addIndex('incidents', ['park_id', 'status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('incidents');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_incidents_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_incidents_severity";');
  },
};
