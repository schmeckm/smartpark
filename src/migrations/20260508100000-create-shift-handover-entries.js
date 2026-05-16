'use strict';

/** Schichtübergabe / Handover: Zeitfenster + Notiz + optionaler Stillstands-Snapshot (OEE MVP). */
module.exports = {
  /** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('shift_handover_entries', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      window_from: { type: Sequelize.DATE, allowNull: false },
      window_to: { type: Sequelize.DATE, allowNull: false },
      shift_label: { type: Sequelize.STRING(64), allowNull: true },
      downtime_snapshot: { type: Sequelize.JSONB, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      created_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('shift_handover_entries', ['park_id', 'window_from'], {
      name: 'idx_shift_handover_park_window_from',
    });
    await queryInterface.addIndex('shift_handover_entries', ['park_id', 'created_at'], {
      name: 'idx_shift_handover_park_created',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('shift_handover_entries');
  },
};
