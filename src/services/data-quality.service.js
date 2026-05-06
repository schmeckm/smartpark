const { DataQualityIssueRepository } = require('../repositories/data-quality-issue.repository');
const env = require('../config/env');

class DataQualityService {
  constructor() {
    this.repository = new DataQualityIssueRepository();
  }

  async createIssue(p) {
    return this.repository.create(p);
  }

  list({ limit, offset, resolved } = {}) {
    return this.repository.findAll({ limit, offset, resolved });
  }

  count({ resolved } = {}) {
    return this.repository.count({ resolved });
  }

  async resolve(id) {
    const row = await this.repository.findById(id);
    if (!row) return null;
    await row.update({ resolved: true });
    return row;
  }

  async recordIssueForPayload(p) {
    return this.createIssue(p);
  }

  validateCrowdLevel(level) {
    if (level === null || level === undefined) return 'crowdLevel is required';
    if (Number(level) < 0) return 'negative crowdLevel';
    return null;
  }

  validateWaitTime(mins) {
    if (mins === null || mins === undefined) return null;
    if (Number(mins) < 0) return 'negative waitTime';
    if (Number(mins) > 1000) return 'impossible waitTime';
    return null;
  }

  validateTimestamp(ts) {
    if (!ts) return 'timestamp missing';
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) return 'invalid timestamp';
    const age = Math.abs(Date.now() - t);
    if (age > env.ingestionMaxAgeMs) return 'stale timestamp (outside allowed window)';
    return null;
  }
}

module.exports = { DataQualityService };
