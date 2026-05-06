const { AuditLog } = require('../models');
const { getRequestContext } = require('../context/request-context-store');

function clientIp(req) {
  if (!req) return null;
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.ip || null;
}

class AuditLogService {
  async log({ action, entityType = null, entityId = null, oldValue = null, newValue = null, userId = null }) {
    const ctx = getRequestContext();
    const req = ctx?.req;
    const resolvedUserId = userId ?? ctx?.userId ?? null;
    const ipAddress = clientIp(req);

    await AuditLog.create({
      userId: resolvedUserId,
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
      ipAddress,
    });
  }
}

module.exports = { AuditLogService };
