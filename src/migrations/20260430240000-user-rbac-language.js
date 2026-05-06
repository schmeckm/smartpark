'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'language_code', {
      type: Sequelize.STRING(10),
      allowNull: false,
      defaultValue: 'en',
    });
    await queryInterface.addColumn('users', 'display_name', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.createTable('user_roles', {
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
      role_code: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex('user_roles', ['user_id']);
    await queryInterface.addIndex('user_roles', ['role_code']);
    await queryInterface.addConstraint('user_roles', {
      fields: ['user_id', 'role_code'],
      type: 'unique',
      name: 'user_roles_user_id_role_code_key',
    });

    await queryInterface.sequelize.query(`
      INSERT INTO user_roles (id, user_id, role_code, created_at, updated_at)
      SELECT gen_random_uuid(), u.id,
        (CASE u.role::text
          WHEN 'ADMIN' THEN 'SYSTEM_ADMIN'
          WHEN 'OPERATIONS_MANAGER' THEN 'OPERATIONS_MANAGER'
          WHEN 'SECURITY_MANAGER' THEN 'PARK_MANAGER'
          WHEN 'OPERATOR' THEN 'ANALYST'
          WHEN 'VIEWER' THEN 'VIEWER'
          ELSE 'VIEWER'
        END),
        NOW(), NOW()
      FROM users u
      ON CONFLICT (user_id, role_code) DO NOTHING
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_roles');
    await queryInterface.removeColumn('users', 'display_name');
    await queryInterface.removeColumn('users', 'language_code');
  },
};
