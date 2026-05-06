const { AppError } = require('../utils/app-error');
const { userHasPermission, rolesHavePermission } = require('../constants/rbac');
const { resolveUserRoleCodes } = require('../constants/role-codes');

function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Unauthorized', 401, { code: 'UNAUTHORIZED' }));
    }
    if (!userHasPermission(req.user, resource, action)) {
      return next(
        new AppError('Insufficient permissions', 403, {
          code: 'FORBIDDEN',
          details: { resource, action, roles: resolveUserRoleCodes(req.user) },
        })
      );
    }
    next();
  };
}

/**
 * @param {Array<[string, string]>} pairs — [resource, action]; user must have at least one
 */
function requireAnyPermission(...pairs) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Unauthorized', 401, { code: 'UNAUTHORIZED' }));
    }
    const codes = resolveUserRoleCodes(req.user);
    const ok = pairs.some(([resource, action]) => rolesHavePermission(codes, resource, action));
    if (!ok) {
      return next(
        new AppError('Insufficient permissions', 403, {
          code: 'FORBIDDEN',
          details: { requiredAny: pairs, roles: codes },
        })
      );
    }
    next();
  };
}

function requireRole(...roleCodes) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Unauthorized', 401, { code: 'UNAUTHORIZED' }));
    }
    const mine = resolveUserRoleCodes(req.user);
    if (!roleCodes.some((r) => mine.includes(r))) {
      return next(
        new AppError('Insufficient role', 403, {
          code: 'FORBIDDEN',
          details: { requiredRoles: roleCodes, roles: mine },
        })
      );
    }
    next();
  };
}

module.exports = { requirePermission, requireAnyPermission, requireRole };
