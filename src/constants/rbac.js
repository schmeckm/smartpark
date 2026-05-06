const fs = require('fs');
const path = require('path');
const { resolveUserRoleCodes } = require('./role-codes');

const manifestPath = path.join(__dirname, '../../shared/rbac.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const ROLES = Object.freeze(
  manifest.roles.reduce((acc, code) => {
    acc[code] = code;
    return acc;
  }, {}),
);

const ROLE_PERMISSIONS = Object.freeze({ ...manifest.rolePermissions });

function permissionKey(resource, action) {
  return `${resource}.${action}`;
}

function rolesHavePermission(roles, resource, action) {
  if (!roles?.length) return false;
  const key = permissionKey(resource, action);
  for (const r of roles) {
    const perms = ROLE_PERMISSIONS[r];
    if (perms === 'ALL') return true;
    if (Array.isArray(perms) && perms.includes(key)) return true;
  }
  return false;
}

function userHasPermission(user, resource, action) {
  const codes = resolveUserRoleCodes(user);
  return rolesHavePermission(codes, resource, action);
}

/** Single role string (legacy) or one code — prefer {@link userHasPermission}. */
function roleHasPermission(role, resource, action) {
  if (!role) return false;
  return rolesHavePermission([role], resource, action);
}

module.exports = {
  ROLES,
  ROLE_PERMISSIONS,
  permissionKey,
  roleHasPermission,
  rolesHavePermission,
  userHasPermission,
};
