'use strict';

/** Demo UNS metric leaves are replaced by integration-driven materialization. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM uns_nodes
      WHERE id IN (
        '7cb76a31-0ef2-4556-b65f-483f0dd6f5be',
        '2df0ebbb-5f65-4cef-8db1-fd3133f4a819'
      )
    `);
  },

  async down() {
    /* no restore: re-run entity sync + materialize to rebuild */
  },
};
