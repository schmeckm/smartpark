'use strict';

const { Op } = require('sequelize');
const env = require('../../../config/env');
const { logger } = require('../../../utils/logger');
const { IntegrationFlowDefinition } = require('../../../models');
const { IntegrationFlowRunner } = require('../runtime/integration-flow-runner');
const { AuditLogService } = require('../../../services/audit-log.service');

const LOCK_CAP_MS = 15 * 60 * 1000;

class IntegrationFlowSchedulerService {
  /**
   * @param {{ runner?: import('../runtime/integration-flow-runner').IntegrationFlowRunner, auditLogService?: import('../../../services/audit-log.service').AuditLogService }} [deps]
   */
  constructor(deps = {}) {
    const audit = deps.auditLogService || new AuditLogService();
    this.runner = deps.runner || new IntegrationFlowRunner({ auditLogService: audit });
    this.auditLogService = audit;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._interval = null;
    this._runningTick = false;
  }

  /**
   * @returns {null | (() => void)}
   */
  startIfEnabled() {
    if (!env.integrationFlowEngineEnabled || !env.integrationFlowSchedulerEnabled) {
      logger.info('integration flow scheduler: not started (engine or INTEGRATION_FLOW_SCHEDULER_ENABLED off)');
      return null;
    }
    const ms = Math.max(5000, env.integrationFlowSchedulerPollSeconds * 1000);
    this._interval = setInterval(() => {
      void this.tick();
    }, ms);
    void this.tick();
    logger.info({ pollSeconds: env.integrationFlowSchedulerPollSeconds }, 'integration flow scheduler: started');
    return () => {
      if (this._interval) clearInterval(this._interval);
      this._interval = null;
      logger.info('integration flow scheduler: stopped');
    };
  }

  async tick() {
    if (this._runningTick) return;
    this._runningTick = true;
    try {
      const now = new Date();
      const rows = await IntegrationFlowDefinition.findAll({
        where: {
          scheduleEnabled: true,
          enabled: true,
          scheduleIntervalSeconds: { [Op.ne]: null },
          nextScheduledRunAt: { [Op.lte]: now },
          [Op.or]: [{ scheduleLockUntil: null }, { scheduleLockUntil: { [Op.lt]: now } }],
        },
        limit: 25,
        order: [['nextScheduledRunAt', 'ASC']],
      });
      for (const row of rows) {
        void this.processDueFlow(row.id);
      }
    } catch (e) {
      logger.warn({ err: e?.message }, 'integration flow scheduler: tick error');
    } finally {
      this._runningTick = false;
    }
  }

  async processDueFlow(flowId) {
    const row = await IntegrationFlowDefinition.findByPk(flowId);
    if (!row || !row.scheduleEnabled || !row.enabled) return;
    const now = new Date();
    if (row.scheduleLockUntil && row.scheduleLockUntil > now) return;
    if (!row.nextScheduledRunAt || row.nextScheduledRunAt > now) return;
    const intervalSec = Number(row.scheduleIntervalSeconds);
    if (!intervalSec) return;

    const lockMs = Math.min(LOCK_CAP_MS, Math.max(intervalSec * 2000, 60000));
    const lockUntil = new Date(Date.now() + lockMs);
    await row.update({ scheduleLockUntil: lockUntil });

    const flowIdForRun = row.id;
    return this.runner
      .runByFlowId(flowIdForRun, {}, { userId: null, scheduled: true })
      .then(async (result) => {
        const fresh = await IntegrationFlowDefinition.findByPk(flowIdForRun);
        if (!fresh) return;
        const nextAt = new Date(Date.now() + intervalSec * 1000);
        await fresh.update({
          lastScheduledRunAt: new Date(),
          nextScheduledRunAt: nextAt,
          scheduleLockUntil: null,
        });
        if (result && result.status === 'success') {
          try {
            await this.auditLogService.log({
              action: 'integration_flow.scheduled_executed',
              entityType: 'IntegrationFlowDefinition',
              entityId: fresh.id,
              newValue: { nextScheduledRunAt: nextAt.toISOString() },
              userId: null,
            });
          } catch {
            /* */
          }
        }
      })
      .catch(async (e) => {
        const msg = e?.message || String(e);
        logger.warn({ flowId: flowIdForRun, err: msg }, 'integration flow scheduler: run failed');
        const nextAt = new Date(Date.now() + intervalSec * 1000);
        try {
          await IntegrationFlowDefinition.update(
            {
              lastScheduledRunAt: new Date(),
              nextScheduledRunAt: nextAt,
              scheduleLockUntil: null,
            },
            { where: { id: flowIdForRun } }
          );
        } catch (e2) {
          logger.warn({ flowId: flowIdForRun, err: e2?.message }, 'integration flow scheduler: unlock failed');
        }
      });
  }
}

module.exports = { IntegrationFlowSchedulerService };
