const { AppError } = require('../utils/app-error');
const { CanonicalInboundMessageRepository } = require('../repositories/canonical-inbound-message.repository');
const { CanonicalMessageValidationService } = require('./canonical-message-validation.service');
const { CanonicalMessageApplyService } = require('./canonical-message-apply.service');
const { emitCanonicalMessageReceived, emitCanonicalMessageApplied, emitCanonicalMessageFailed } = require('../sockets');

class CanonicalInboundMessageService {
  constructor() {
    this.repository = new CanonicalInboundMessageRepository();
    this.validationService = new CanonicalMessageValidationService();
    this.applyService = new CanonicalMessageApplyService();
  }

  list(filters) {
    return this.repository.findAll(filters);
  }

  findById(id) {
    return this.repository.findById(id);
  }

  async ingest(messages, { autoApply = true } = {}) {
    const rows = await this.repository.createMany(messages);
    for (const row of rows) {
      emitCanonicalMessageReceived(row.toJSON ? row.toJSON() : row);
      try {
        this.validationService.validate(row);
        await row.update({ status: 'VALIDATED', errorMessage: null });
      } catch (e) {
        await row.update({ status: 'FAILED', errorMessage: e.message });
        emitCanonicalMessageFailed({ message: row.toJSON ? row.toJSON() : row, error: e.message });
        continue;
      }
      if (!autoApply) continue;
      try {
        const applied = await this.applyService.apply(row);
        await row.update({ status: applied.applied ? 'APPLIED' : 'IGNORED', errorMessage: null });
        emitCanonicalMessageApplied({
          message: row.toJSON ? row.toJSON() : row,
          applied: applied.applied,
        });
      } catch (e) {
        await row.update({ status: 'FAILED', errorMessage: e.message });
        emitCanonicalMessageFailed({ message: row.toJSON ? row.toJSON() : row, error: e.message });
      }
    }
    return rows;
  }

  async reprocess(id) {
    const row = await this.repository.findById(id);
    if (!row) throw new AppError('Canonical message not found', 404, { code: 'NOT_FOUND' });
    this.validationService.validate(row);
    const applied = await this.applyService.apply(row);
    await row.update({ status: applied.applied ? 'APPLIED' : 'IGNORED', errorMessage: null });
    emitCanonicalMessageApplied({ message: row.toJSON ? row.toJSON() : row, applied: applied.applied });
    return row;
  }
}

module.exports = { CanonicalInboundMessageService };
