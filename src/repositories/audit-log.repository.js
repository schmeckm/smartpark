const { AuditLog, User } = require('../models');

class AuditLogRepository {
  create(data) {
    return AuditLog.create(data);
  }

  findAll(options = {}) {
    return AuditLog.findAll({
      order: [['createdAt', 'DESC']],
      limit: options.limit || 100,
      offset: options.offset || 0,
      include: [{ model: User, as: 'user', attributes: ['id', 'email', 'firstName', 'lastName', 'role'] }],
    });
  }

  count() {
    return AuditLog.count();
  }
}

module.exports = { AuditLogRepository };
