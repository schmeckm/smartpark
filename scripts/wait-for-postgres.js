/**
 * Waits until PostgreSQL accepts connections (used by Docker entrypoint).
 */
require('dotenv').config();

const { Client } = require('pg');
const { getDbHost } = require('../config/db-host');

const host = getDbHost();
const port = Number(process.env.DB_PORT) || 5432;
const user = process.env.DB_USER || 'smartpark';
const password = process.env.DB_PASSWORD || 'smartpark';
const database = process.env.DB_NAME || 'smartpark';

const maxAttempts = 60;
const delayMs = 2000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = new Client({
      host,
      port,
      user,
      password,
      database,
      connectionTimeoutMillis: 3000,
    });
    try {
      await client.connect();
      await client.end();
      process.stdout.write(`PostgreSQL is ready (${host}:${port}/${database})\n`);
      return;
    } catch (err) {
      process.stdout.write(
        `[${attempt}/${maxAttempts}] waiting for PostgreSQL: ${err.message}\n`
      );
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      await sleep(delayMs);
    }
  }
  process.stderr.write('PostgreSQL did not become ready in time.\n');
  process.exit(1);
}

main();
