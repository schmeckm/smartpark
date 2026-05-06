'use strict';

/**
 * Hierarchical SQDC: daily scored snapshots, unified events, mood feedback (numeric).
 * Coexists with legacy tables from 20260503210000-sqdc-board.js (board_snapshots, mood_ratings, safety_events).
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('sqdc_daily_snapshots', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      park_id: { type: DataTypes.UUID, allowNull: false },
      asset_id: { type: DataTypes.UUID, allowNull: true },
      snapshot_date: { type: DataTypes.DATEONLY, allowNull: false },
      level: { type: DataTypes.STRING(16), allowNull: false },
      safety_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      quality_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      delivery_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      customer_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      overall_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      safety_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      quality_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      delivery_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      customer_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ai_recommendations_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('sqdc_daily_snapshots', ['park_id', 'snapshot_date'], {
      name: 'sqdc_daily_snapshots_park_date',
    });
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX sqdc_daily_snapshots_park_level_day
      ON sqdc_daily_snapshots (park_id, snapshot_date)
      WHERE level = 'PARK' AND asset_id IS NULL;
    `);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX sqdc_daily_snapshots_asset_level_day
      ON sqdc_daily_snapshots (park_id, asset_id, snapshot_date)
      WHERE level = 'ASSET' AND asset_id IS NOT NULL;
    `);

    await queryInterface.createTable('sqdc_events', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      park_id: { type: DataTypes.UUID, allowNull: false },
      asset_id: { type: DataTypes.UUID, allowNull: true },
      event_type: { type: DataTypes.STRING(32), allowNull: false },
      severity: { type: DataTypes.STRING(16), allowNull: false },
      title: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'OPEN' },
      source: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'MANUAL' },
      event_time: { type: DataTypes.DATE, allowNull: false },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
      metadata_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('sqdc_events', ['park_id', 'event_time'], { name: 'sqdc_events_park_time' });
    await queryInterface.addIndex('sqdc_events', ['park_id', 'asset_id', 'status'], { name: 'sqdc_events_park_asset_status' });

    await queryInterface.createTable('sqdc_mood_feedback', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      park_id: { type: DataTypes.UUID, allowNull: false },
      asset_id: { type: DataTypes.UUID, allowNull: true },
      mood_score: { type: DataTypes.SMALLINT, allowNull: false },
      comment: { type: DataTypes.TEXT, allowNull: true },
      feedback_date: { type: DataTypes.DATEONLY, allowNull: false },
      created_by_user_id: { type: DataTypes.UUID, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('sqdc_mood_feedback', ['park_id', 'feedback_date'], {
      name: 'sqdc_mood_feedback_park_day',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('sqdc_mood_feedback');
    await queryInterface.dropTable('sqdc_events');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS sqdc_daily_snapshots_asset_level_day;');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS sqdc_daily_snapshots_park_level_day;');
    await queryInterface.dropTable('sqdc_daily_snapshots');
  },
};
