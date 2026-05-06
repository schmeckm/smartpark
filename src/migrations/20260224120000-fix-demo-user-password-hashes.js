'use strict';

const PASSWORD_HASH = '$2b$12$3Sh7oawo1BYuTWa89DgM3uDx2CzvBTPaSHGK0SGACa54Z6Bq1QUO6';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE "users" SET "password_hash" = $1, "updated_at" = NOW() WHERE "email" IN (
        'admin@smartpark.com',
        'operator@smartpark.com',
        'viewer@smartpark.com',
        'operations@smartpark.com',
        'security@smartpark.com'
      )`,
      { bind: [PASSWORD_HASH] }
    );
  },

  async down() {
    // Cannot restore previous hashes; down is a no-op.
  },
};
