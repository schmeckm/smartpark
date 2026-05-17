const { Sequelize } = require('sequelize');
const env = require('../config/env');

const poolMax = Number(process.env.DB_POOL_MAX) || 20;
const poolMin = Number(process.env.DB_POOL_MIN) || 2;

const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
  host: env.db.host,
  port: env.db.port,
  dialect: 'postgres',
  logging: false,
  pool: {
    max: poolMax,
    min: poolMin,
    acquire: Number(process.env.DB_POOL_ACQUIRE_MS) || 30000,
    idle: Number(process.env.DB_POOL_IDLE_MS) || 10000,
  },
});

module.exports = { sequelize };
