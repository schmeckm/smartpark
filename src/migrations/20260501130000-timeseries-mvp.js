'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('park_calendar_context', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      context_date: { type: Sequelize.DATEONLY, allowNull: false, field: 'context_date' },
      is_public_holiday: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_public_holiday',
      },
      is_school_break: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_school_break',
      },
      holiday_name: { type: Sequelize.STRING(200), allowNull: true, field: 'holiday_name' },
      region_code: { type: Sequelize.STRING(32), allowNull: true, field: 'region_code' },
      source: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'manual' },
      extra: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('park_calendar_context', ['park_id', 'context_date'], {
      unique: true,
      name: 'uq_park_calendar_context_park_date',
    });

    await queryInterface.addColumn('ride_wait_time_samples', 'park_asset_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'park_assets', key: 'asset_id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('ride_wait_time_samples', ['park_asset_id', 'sampled_at'], {
      name: 'idx_ride_wait_samples_asset_sampled',
    });

    await queryInterface.addColumn('weather_observations', 'internal_park_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'parks', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('weather_observations', ['internal_park_id', 'observed_at'], {
      name: 'idx_weather_observations_internal_park_observed',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('weather_observations', 'idx_weather_observations_internal_park_observed');
    await queryInterface.removeColumn('weather_observations', 'internal_park_id');
    await queryInterface.removeIndex('ride_wait_time_samples', 'idx_ride_wait_samples_asset_sampled');
    await queryInterface.removeColumn('ride_wait_time_samples', 'park_asset_id');
    await queryInterface.dropTable('park_calendar_context');
  },
};
