'use strict';

// bcrypt 12: Smartpark123! (regenerate with: node -e "require('bcrypt').hash('Smartpark123!',12).then(console.log)")
const PASSWORD_HASH = '$2b$12$3Sh7oawo1BYuTWa89DgM3uDx2CzvBTPaSHGK0SGACa54Z6Bq1QUO6';

const U_ADMIN = 'a2000001-0000-4000-8000-000000000001';
const U_OPS = 'a2000001-0000-4000-8000-000000000002';
const U_VIEWER = 'a2000001-0000-4000-8000-000000000003';
const U_OPS_MGR = 'a2000001-0000-4000-8000-000000000004';
const U_SEC_MGR = 'a2000001-0000-4000-8000-000000000005';

const now = new Date();

module.exports = {
  async up(queryInterface) {
    const [existingUser] = await queryInterface.sequelize.query(
      'SELECT 1 AS x FROM "users" WHERE "id" = $1 LIMIT 1',
      { bind: [U_ADMIN] }
    );
    if (existingUser && existingUser.length) {
      return;
    }

    await queryInterface.bulkInsert(
      'users',
      [
        {
          id: U_ADMIN,
          first_name: 'System',
          last_name: 'Administrator',
          email: 'admin@smartpark.com',
          password_hash: PASSWORD_HASH,
          role: 'ADMIN',
          active: true,
          last_login_at: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: U_OPS,
          first_name: 'Park',
          last_name: 'Operator',
          email: 'operator@smartpark.com',
          password_hash: PASSWORD_HASH,
          role: 'OPERATOR',
          active: true,
          last_login_at: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: U_VIEWER,
          first_name: 'Guest',
          last_name: 'Viewer',
          email: 'viewer@smartpark.com',
          password_hash: PASSWORD_HASH,
          role: 'VIEWER',
          active: true,
          last_login_at: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: U_OPS_MGR,
          first_name: 'Operations',
          last_name: 'Manager',
          email: 'operations@smartpark.com',
          password_hash: PASSWORD_HASH,
          role: 'OPERATIONS_MANAGER',
          active: true,
          last_login_at: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: U_SEC_MGR,
          first_name: 'Security',
          last_name: 'Manager',
          email: 'security@smartpark.com',
          password_hash: PASSWORD_HASH,
          role: 'SECURITY_MANAGER',
          active: true,
          last_login_at: null,
          created_at: now,
          updated_at: now,
        },
      ],
      {}
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM users WHERE email IN ('admin@smartpark.com','operator@smartpark.com','viewer@smartpark.com','operations@smartpark.com','security@smartpark.com');`
    );
  },
};
