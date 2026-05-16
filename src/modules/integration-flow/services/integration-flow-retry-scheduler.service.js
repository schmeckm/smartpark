'use strict';

const { Op } = require('sequelize');
const env = require('../../../config/env');
const { logger } = require('../../../utils/logger');
const { IntegrationFlowRun, IntegrationFlowDefinition } = require('../../../models');
const { IntegrationFlowRunner } = require('../runtime/integration-flow-runner');
const { AuditLogService } = require('../../../services/audit-log.service');
const { RETRY_STATUS } = require('./integration-flow-retry.helper');

class IntegrationFlowRetrySchedulerService {
  /**
   * @param {{ runner?: import('../runtime/integration-flow-runner').IntegrationFlowRunner, auditLogService?: import('../../../services/audit-log.service').AuditLogService }} [deps]
   */
  constructor(deps = {}) {
    const audit = deps.auditLogService || new AuditLogService();
    this.runner = deps.runner || new IntegrationFlowRunner({ auditLogService: audit });
    this.auditLogService = audit;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._interval = null;
    this._tickRunning = false;
  }

  /**
   * @returns {null | (() => void)}
   */
  startIfEnabled() {
    if (!env.integrationFlowEngineEnabled || !env.integrationFlowRetrySchedulerEnabled) {
      logger.info('integration flow retry scheduler: not started (engine or INTEGRATION_FLOW_RETRY_SCHEDULER_ENABLED off)');
      return null;
    }
    const ms = Math.max(5000, env.integrationFlowRetrySchedulerPollSeconds * 1000);
    this._interval = setInterval(() => {
      void this.tick();
    }, ms);
    void this.tick();
    logger.info({ pollSeconds: env.integrationFlowRetrySchedulerPollSeconds }, 'integration flow retry scheduler: started');
    return () => {
      if (this._interval) clearInterval(this._interval);
      this._interval = null;
      logger.info('integration flow retry scheduler: stopped');
    };
  }

  async tick() {
    if (this._tickRunning) return;
    this._tickRunning = true;
    try {
      const now = new Date();
      const rows = await IntegrationFlowRun.findAll({
        where: {
          status: 'failed',
          retryStatus: RETRY_STATUS.PENDING_RETRY,
          nextRetryAt: { [Op.lte]: now },
          [Op.or]: [{ retryLockUntil: null }, { retryLockUntil: { [Op.lt]: now } }],
        },
        limit: 20,
        order: [['nextRetryAt', 'ASC']],
      });
      for (const r of rows) {
        try {
          const def = await IntegrationFlowDefinition.findByPk(r.flowId);
          if (!def || !def.enabled) {
            await IntegrationFlowRun.update(
              {
                retryStatus: RETRY_STATUS.NOT_APPLICABLE,
                nextRetryAt: null,
                retryLockUntil: null,
              },
              { where: { id: r.id } }
            );
            continue;
          }
          const plain = def.toJSON ? def.toJSON() : def;
          if (plain.retryEnabled !== true) {
            await IntegrationFlowRun.update(
              {
                retryStatus: RETRY_STATUS.NOT_APPLICABLE,
                nextRetryAt: null,
                retryLockUntil: null,
              },
              { where: { id: r.id } }
            );
            continue;
          }
          void this.runner
            .runRetryFromFailedRun(r.id, { userId: null, scheduled: true })
            .catch((e) => {
              logger.warn({ runId: r.id, err: e?.message }, 'integration flow retry scheduler: run failed');
            });
        } catch (e) {
          logger.warn({ runId: r.id, err: e?.message }, 'integration flow retry scheduler: tick item error');
        }
      }
    } catch (e) {
      logger.warn({ err: e?.message }, 'integration flow retry scheduler: tick error');
    } finally {
      this._tickRunning = false;
    }
  }
}

module.exports = { IntegrationFlowRetrySchedulerService };
