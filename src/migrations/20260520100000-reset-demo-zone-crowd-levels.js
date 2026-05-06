'use strict';

module.exports = {
  async up(queryInterface) {
    /** Fixed UUIDs from `20250424130001-demo-alpenresort-kingdom.js` — demo zones only. */
    await queryInterface.sequelize.query(`
      UPDATE zones
      SET current_crowd_level = 0, forecast_crowd_level = 0, updated_at = NOW()
      WHERE id IN (
        'b1000001-0000-4000-8000-000000000001',
        'b1000001-0000-4000-8000-000000000002',
        'b1000001-0000-4000-8000-000000000003',
        'b1000001-0000-4000-8000-000000000004',
        'b1000001-0000-4000-8000-000000000005'
      )
    `);
  },

  async down() {
    /* Irreversible: prior demo numbers were illustrative only. */
  },
};
