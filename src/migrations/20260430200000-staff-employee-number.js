'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('staff', 'employee_number', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addIndex('staff', ['employee_number'], {
      unique: true,
      name: 'staff_employee_number_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('staff', 'staff_employee_number_unique');
    await queryInterface.removeColumn('staff', 'employee_number');
  },
};
