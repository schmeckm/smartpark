'use strict';

/** Align demo UNS rows with `slugifyName("Europa Park")` → `europa_park` (topic segment + uns_nodes.park_id). */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    const q = (sql) => queryInterface.sequelize.query(sql);
    if (dialect === 'postgres') {
      await q(`
        UPDATE uns_nodes
        SET park_id = 'europa_park',
            topic_path = CASE
              WHEN topic_path IS NOT NULL THEN REPLACE(topic_path::text, 'tpuns/europapark/', 'tpuns/europa_park/')::varchar(500)
              ELSE NULL
            END
        WHERE park_id = 'europapark'
      `);
      await q(`
        UPDATE uns_latest_states
        SET park_id = 'europa_park',
            topic_path = REPLACE(topic_path::text, 'tpuns/europapark/', 'tpuns/europa_park/')::varchar(500)
        WHERE park_id = 'europapark'
      `);
    } else {
      await q(`
        UPDATE uns_nodes
        SET park_id = 'europa_park',
            topic_path = CASE
              WHEN topic_path IS NOT NULL THEN REPLACE(topic_path, 'tpuns/europapark/', 'tpuns/europa_park/')
              ELSE NULL
            END
        WHERE park_id = 'europapark'
      `);
      await q(`
        UPDATE uns_latest_states
        SET park_id = 'europa_park',
            topic_path = REPLACE(topic_path, 'tpuns/europapark/', 'tpuns/europa_park/')
        WHERE park_id = 'europapark'
      `);
    }
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    const q = (sql) => queryInterface.sequelize.query(sql);
    if (dialect === 'postgres') {
      await q(`
        UPDATE uns_nodes
        SET park_id = 'europapark',
            topic_path = CASE
              WHEN topic_path IS NOT NULL THEN REPLACE(topic_path::text, 'tpuns/europa_park/', 'tpuns/europapark/')::varchar(500)
              ELSE NULL
            END
        WHERE park_id = 'europa_park'
      `);
      await q(`
        UPDATE uns_latest_states
        SET park_id = 'europapark',
            topic_path = REPLACE(topic_path::text, 'tpuns/europa_park/', 'tpuns/europapark/')::varchar(500)
        WHERE park_id = 'europa_park'
      `);
    } else {
      await q(`
        UPDATE uns_nodes
        SET park_id = 'europapark',
            topic_path = CASE
              WHEN topic_path IS NOT NULL THEN REPLACE(topic_path, 'tpuns/europa_park/', 'tpuns/europapark/')
              ELSE NULL
            END
        WHERE park_id = 'europa_park'
      `);
      await q(`
        UPDATE uns_latest_states
        SET park_id = 'europapark',
            topic_path = REPLACE(topic_path, 'tpuns/europa_park/', 'tpuns/europapark/')
        WHERE park_id = 'europa_park'
      `);
    }
  },
};
