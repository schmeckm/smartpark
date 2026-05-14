'use strict';

/**
 * Shift handover workflow expansion:
 * - acknowledgement by next shift
 * - follow-up task list
 * - diff snapshot against previous handover
 * - reminder scheduling and mark-sent
 */
module.exports = {
  /** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('shift_handover_entries', 'acknowledged_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('shift_handover_entries', 'acknowledged_by_user_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('shift_handover_entries', 'acknowledgement_note', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('shift_handover_entries', 'follow_up_tasks', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
    await queryInterface.addColumn('shift_handover_entries', 'diff_snapshot', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await queryInterface.addColumn('shift_handover_entries', 'reminder_due_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('shift_handover_entries', 'reminder_sent_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addIndex('shift_handover_entries', ['park_id', 'acknowledged_at'], {
      name: 'idx_shift_handover_park_acknowledged',
    });
    await queryInterface.addIndex('shift_handover_entries', ['park_id', 'reminder_due_at', 'reminder_sent_at'], {
      name: 'idx_shift_handover_park_reminder_due',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('shift_handover_entries', 'idx_shift_handover_park_reminder_due');
    await queryInterface.removeIndex('shift_handover_entries', 'idx_shift_handover_park_acknowledged');
    await queryInterface.removeColumn('shift_handover_entries', 'reminder_sent_at');
    await queryInterface.removeColumn('shift_handover_entries', 'reminder_due_at');
    await queryInterface.removeColumn('shift_handover_entries', 'diff_snapshot');
    await queryInterface.removeColumn('shift_handover_entries', 'follow_up_tasks');
    await queryInterface.removeColumn('shift_handover_entries', 'acknowledgement_note');
    await queryInterface.removeColumn('shift_handover_entries', 'acknowledged_by_user_id');
    await queryInterface.removeColumn('shift_handover_entries', 'acknowledged_at');
  },
};
