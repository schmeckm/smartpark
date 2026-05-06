const { AppError } = require('../utils/app-error');
const { RecommendationRepository } = require('../repositories/recommendation.repository');
const { emitRecommendationUpdated } = require('../sockets');
const { AuditLogService } = require('./audit-log.service');
const { jsonSnapshot } = require('../utils/json-snapshot');
const AUDIT = require('../constants/audit-actions');

const ALLOWED_STATUSES = ['OPEN', 'ACCEPTED', 'REJECTED', 'COMPLETED'];

const auditLogService = new AuditLogService();

class RecommendationService {
  constructor() {
    this.recommendationRepository = new RecommendationRepository();
  }

  listRecommendations() {
    return this.recommendationRepository.findAll({ limit: 500 });
  }

  async updateStatus(id, status) {
    if (!ALLOWED_STATUSES.includes(status)) {
      throw new AppError('Invalid status', 422, {
        code: 'VALIDATION_ERROR',
        details: { allowed: ALLOWED_STATUSES },
      });
    }
    const before = await this.recommendationRepository.findById(id);
    if (!before) throw new AppError('Recommendation not found', 404, { code: 'NOT_FOUND' });

    const rec = await this.recommendationRepository.updateById(id, { status });
    if (!rec) throw new AppError('Recommendation not found', 404, { code: 'NOT_FOUND' });
    emitRecommendationUpdated(rec);

    await auditLogService.log({
      action: AUDIT.RECOMMENDATION_STATUS,
      entityType: 'recommendation',
      entityId: id,
      oldValue: { status: before.status },
      newValue: { status: rec.status },
    });

    return rec;
  }
}

module.exports = { RecommendationService };
