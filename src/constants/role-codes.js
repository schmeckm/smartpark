/**
 * Canonical RBAC role codes (multi-role via `user_roles`).
 * Legacy `users.role` enum is mapped on read until rows exist in `user_roles`.
 */
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '../../shared/rbac.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const ROLE_CODES = Object.freeze(
  manifest.roles.reduce((acc, code) => {
    acc[code] = code;
    return acc;
  }, {}),
);

/** Maps legacy single `users.role` to one primary role_code for `user_roles` backfill. */
const LEGACY_USER_ROLE_TO_CODE = Object.freeze({
  ADMIN: ROLE_CODES.SYSTEM_ADMIN,
  OPERATIONS_MANAGER: ROLE_CODES.OPERATIONS_MANAGER,
  SECURITY_MANAGER: ROLE_CODES.PARK_MANAGER,
  OPERATOR: ROLE_CODES.ANALYST,
  VIEWER: ROLE_CODES.VIEWER,
});

function roleCodesFromLegacyEnum(legacyRole) {
  const r = legacyRole != null ? String(legacyRole).trim() : '';
  const code = LEGACY_USER_ROLE_TO_CODE[r];
  return code ? [code] : [ROLE_CODES.VIEWER];
}

/**
 * @param {import('sequelize').Model} user — User instance with optional `userRoles` association
 * @returns {string[]}
 */
function resolveUserRoleCodes(user) {
  const rows = user.userRoles;
  if (Array.isArray(rows) && rows.length) {
    const set = new Set();
    for (const row of rows) {
      const c = row.roleCode != null ? String(row.roleCode).trim() : '';
      if (c) set.add(c);
    }
    if (set.size) return [...set];
  }
  return roleCodesFromLegacyEnum(user.role);
}

module.exports = {
  ROLE_CODES,
  LEGACY_USER_ROLE_TO_CODE,
  roleCodesFromLegacyEnum,
  resolveUserRoleCodes,
};
