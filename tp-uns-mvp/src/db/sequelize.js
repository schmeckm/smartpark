const { Sequelize } = require('sequelize');
const env = require('../config/env');

const sequelize = new Sequelize(env.databaseUrl, {
  logging: false,
  dialect: 'postgres',
});

module.exports = { sequelize };
