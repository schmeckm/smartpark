require('dotenv').config();
const { defaultDbHost } = require('./service-defaults');

/**
 * Resolve DB host for `pg` / Sequelize.
 * On Windows, `localhost` often resolves to IPv6 (::1) while PostgreSQL listens on IPv4 only,
 * which yields ECONNREFUSED ::1:5432. Using 127.0.0.1 avoids that on the host.
 * Inside Docker Compose, the default is the `db` service name when DB_HOST is unset.
 */
function resolveDbHost(raw) {
  if (raw === undefined || raw === null) return defaultDbHost();
  const h = String(raw).trim();
  if (!h) return defaultDbHost();
  if (h.toLowerCase() === 'localhost') return '127.0.0.1';
  return h;
}

function getDbHost() {
  return resolveDbHost(process.env.DB_HOST);
}

module.exports = { resolveDbHost, getDbHost };
