'use strict';

/** User ↔ park assignments for multi-tenant scoping (X-Park-Id, sockets). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_parks', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('user_parks', ['user_id', 'park_id'], { unique: true, name: 'user_parks_user_park_uq' });
    await queryInterface.addIndex('user_parks', ['park_id'], { name: 'user_parks_park_id_idx' });

    // Backfill: every active user can access every park (preserves Phase-0 behaviour).
    await queryInterface.sequelize.query(`
      INSERT INTO user_parks (id, user_id, park_id, created_at, updated_at)
      SELECT gen_random_uuid(), u.id, p.id, NOW(), NOW()
      FROM users u
      CROSS JOIN parks p
      WHERE u.active = true
      ON CONFLICT (user_id, park_id) DO NOTHING
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_parks');
  },
};
