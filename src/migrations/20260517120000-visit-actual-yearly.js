'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('visit_actual_yearly', {
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
      actual_year: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      guest_counts: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addConstraint('visit_actual_yearly', {
      fields: ['park_id', 'actual_year'],
      type: 'unique',
      name: 'visit_actual_yearly_park_year_uq',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('visit_actual_yearly');
  },
};
