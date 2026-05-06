'use strict';

/** Domain root only; metric leaves come from integration materialization (`uns.materialize`). */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const parkId = 'europa_park';
    const rows = [
      {
        id: '8be9bc84-4f2e-4f4a-8519-7cb1b58fdb11',
        park_id: parkId,
        parent_id: null,
        name: 'Rides',
        slug: 'rides',
        node_type: 'DOMAIN',
        domain: 'rides',
        metric: null,
        topic_path: null,
        description: 'Ride telemetry domain',
        is_leaf: false,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ];
    await queryInterface.bulkInsert('uns_nodes', rows, {
      ignoreDuplicates: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('uns_nodes', {
      id: ['8be9bc84-4f2e-4f4a-8519-7cb1b58fdb11'],
    });
  },
};
