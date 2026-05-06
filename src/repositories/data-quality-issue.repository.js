const { DataQualityIssue } = require('../models');

class DataQualityIssueRepository {
  create(data) {
    return DataQualityIssue.create(data);
  }

  findById(id) {
    return DataQualityIssue.findByPk(id);
  }

  findAll({ limit = 200, offset = 0, resolved = undefined } = {}) {
    const where = {};
    if (resolved === true) where.resolved = true;
    if (resolved === false) where.resolved = false;
    return DataQualityIssue.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });
  }

  count({ resolved } = {}) {
    const where = {};
    if (resolved === true) where.resolved = true;
    if (resolved === false) where.resolved = false;
    return DataQualityIssue.count({ where });
  }
}

module.exports = { DataQualityIssueRepository };
