'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'timezone', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'date_format', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'YYYY-MM-DD',
    });
    await queryInterface.addColumn('users', 'time_format', {
      type: Sequelize.STRING(8),
      allowNull: false,
      defaultValue: '24h',
    });
    await queryInterface.addColumn('users', 'locale', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'locale');
    await queryInterface.removeColumn('users', 'time_format');
    await queryInterface.removeColumn('users', 'date_format');
    await queryInterface.removeColumn('users', 'timezone');
  },
};
