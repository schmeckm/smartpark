require('dotenv').config();
const { getDbHost } = require('./db-host');

const common = {
  dialect: 'postgres',
  logging: false,
};

module.exports = {
  development: {
    ...common,
    host: getDbHost(),
    // Default 15432 matches `docker compose` db port map (host 15432 -> container 5432). Without
    // this, the fallback 5432 often hits a different Postgres on Windows and auth fails.
    // Use DB_PORT=5432 in .env for a local Postgres on the standard port.
    port: Number(process.env.DB_PORT) || 15432,
    database: process.env.DB_NAME || 'smartpark',
    username: process.env.DB_USER || 'smartpark',
    password: process.env.DB_PASSWORD || 'smartpark',
  },
  test: {
    ...common,
    host: getDbHost(),
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'smartpark_test',
    username: process.env.DB_USER || 'smartpark',
    password: process.env.DB_PASSWORD || 'smartpark',
  },
  production: {
    ...common,
    host: getDbHost(),
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    dialectOptions: {
      ssl:
        process.env.DB_SSL === 'true'
          ? { require: true, rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
          : false,
    },
  },
};
