'use strict';

/** SQDC board: daily snapshots, team mood, and safety log entries (near-miss / accident). */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('sqdc_board_snapshots', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      park_id: { type: DataTypes.UUID, allowNull: false },
      /** Platform ride / attraction UUID (`park_assets.asset_id`). */
      asset_id: { type: DataTypes.UUID, allowNull: false },
      business_date: { type: DataTypes.DATEONLY, allowNull: false },
      delivery_oee_5m: { type: DataTypes.DECIMAL(6, 3), allowNull: true },
      customer_guest_count: { type: DataTypes.INTEGER, allowNull: true },
      lead_technician_name: { type: DataTypes.STRING(200), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      captured_by_user_id: { type: DataTypes.UUID, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('sqdc_board_snapshots', ['park_id', 'asset_id', 'business_date'], {
      name: 'sqdc_snapshots_park_asset_date',
      unique: true,
    });

    await queryInterface.createTable('sqdc_mood_ratings', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      park_id: { type: DataTypes.UUID, allowNull: false },
      asset_id: { type: DataTypes.UUID, allowNull: true },
      user_id: { type: DataTypes.UUID, allowNull: false },
      business_date: { type: DataTypes.DATEONLY, allowNull: false },
      mood: { type: DataTypes.STRING(16), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('sqdc_mood_ratings', ['park_id', 'user_id', 'business_date'], {
      name: 'sqdc_mood_user_day',
      unique: true,
    });
    await queryInterface.addIndex('sqdc_mood_ratings', ['park_id', 'business_date'], {
      name: 'sqdc_mood_park_day',
    });

    await queryInterface.createTable('sqdc_safety_events', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      park_id: { type: DataTypes.UUID, allowNull: false },
      asset_id: { type: DataTypes.UUID, allowNull: true },
      kind: { type: DataTypes.STRING(24), allowNull: false },
      title: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      occurred_at: { type: DataTypes.DATE, allowNull: false },
      created_by_user_id: { type: DataTypes.UUID, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('sqdc_safety_events', ['park_id', 'occurred_at'], {
      name: 'sqdc_safety_park_time',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('sqdc_safety_events');
    await queryInterface.dropTable('sqdc_mood_ratings');
    await queryInterface.dropTable('sqdc_board_snapshots');
  },
};
