const { AppError } = require('../utils/app-error');
const { userHasPermission } = require('../constants/rbac');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Phase 0: optional `X-Park-Id` on authenticated API calls.
 * - Validates UUID + park exists.
 * - Access: user must have rides.read, ops.read, or integrations.read (SYSTEM_ADMIN = ALL).
 * - Later: restrict via user_parks / tenant.
 *
 * Attaches `req.parkContext` = `{ id, name } | null`.
 */
async function attachParkContext(req, res, next) {
  req.parkContext = null;
  if (!req.user) return next();

  const raw = req.get('x-park-id') || req.get('X-Park-Id');
  if (raw == null || String(raw).trim() === '') {
    return next();
  }

  const id = String(raw).trim();
  if (!UUID_RE.test(id)) {
    return next(new AppError('Invalid X-Park-Id', 400, { code: 'INVALID_PARK_ID' }));
  }

  const canScope =
    userHasPermission(req.user, 'rides', 'read') ||
    userHasPermission(req.user, 'ops', 'read') ||
    userHasPermission(req.user, 'integrations', 'read');
  if (!canScope) {
    return next(new AppError('Park context not allowed for this user', 403, { code: 'PARK_CONTEXT_FORBIDDEN' }));
  }

  const { Park } = require('../models');
  const park = await Park.findByPk(id, { attributes: ['id', 'name'] });
  if (!park) {
    return next(new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' }));
  }

  const plain = park.get({ plain: true });
  req.parkContext = { id: plain.id, name: plain.name };
  return next();
}

function requireParkContext(req, res, next) {
  if (!req.parkContext?.id) {
    return next(
      new AppError('X-Park-Id header is required for this resource', 400, { code: 'PARK_CONTEXT_REQUIRED' })
    );
  }
  next();
}

module.exports = { attachParkContext, requireParkContext };
