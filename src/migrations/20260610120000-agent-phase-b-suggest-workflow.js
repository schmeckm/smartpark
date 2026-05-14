'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('agent_runs', 'mode', {
      type: Sequelize.STRING(16),
      allowNull: false,
      defaultValue: 'auto',
    });
    await queryInterface.addColumn('agent_runs', 'trigger_ref', {
      type: Sequelize.STRING(128),
      allowNull: true,
    });

    await queryInterface.addColumn('agent_actions', 'target_type', {
      type: Sequelize.STRING(40),
      allowNull: true,
    });
    await queryInterface.addColumn('agent_actions', 'target_id', {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await queryInterface.addColumn('agent_actions', 'approved_by_user_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('agent_actions', 'approved_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('agent_actions', 'rejected_reason', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addIndex('agent_actions', ['run_id', 'status'], {
      name: 'agent_actions_run_id_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('agent_actions', 'agent_actions_run_id_status_idx');
    await queryInterface.removeColumn('agent_actions', 'rejected_reason');
    await queryInterface.removeColumn('agent_actions', 'approved_at');
    await queryInterface.removeColumn('agent_actions', 'approved_by_user_id');
    await queryInterface.removeColumn('agent_actions', 'target_id');
    await queryInterface.removeColumn('agent_actions', 'target_type');
    await queryInterface.removeColumn('agent_runs', 'trigger_ref');
    await queryInterface.removeColumn('agent_runs', 'mode');
  },
};
