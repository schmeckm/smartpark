require('dotenv').config();

/**
 * Resolve DB host for `pg` / Sequelize.
 * On Windows, `localhost` often resolves to IPv6 (::1) while PostgreSQL listens on IPv4 only,
 * which yields ECONNREFUSED ::1:5432. Using 127.0.0.1 avoids that. Docker and remote DBs use a
 * real hostname (e.g. `db`) and are unchanged.
 */
function resolveDbHost(raw) {
  if (raw === undefined || raw === null) return '127.0.0.1';
  const h = String(raw).trim();
  if (!h) return '127.0.0.1';
  if (h.toLowerCase() === 'localhost') return '127.0.0.1';
  return h;
}

function getDbHost() {
  return resolveDbHost(process.env.DB_HOST);
}

module.exports = { resolveDbHost, getDbHost };
