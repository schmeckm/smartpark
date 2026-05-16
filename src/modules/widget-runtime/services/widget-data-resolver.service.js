'use strict';

const { Op } = require('sequelize');
const env = require('../../../config/env');
const { IntegrationFlowDefinition, IntegrationFlowRun } = require('../../../models');
const { AppError } = require('../../../utils/app-error');
const { IntegrationFlowService } = require('../../integration-flow/services/integration-flow.service');
const { IntegrationFlowFailureInboxService } = require('../../integration-flow/services/integration-flow-failure-inbox.service');

const flowService = new IntegrationFlowService();
const failureInboxService = new IntegrationFlowFailureInboxService();

function assertIntegrationFlowsAvailable() {
  if (!env.integrationFlowEngineEnabled) {
    throw new AppError('Integration Flow Engine is not enabled', 503, { code: 'INTEGRATION_FLOW_ENGINE_OFF' });
  }
}

/**
 * @param {string} dataSourceKey
 * @param {object} widgetConfig
 */
async function resolveData(dataSourceKey, widgetConfig = {}) {
  const key = String(dataSourceKey || '').trim();
  assertIntegrationFlowsAvailable();

  switch (key) {
    case 'integration_flows.health_summary':
      return resolveHealthSummary(widgetConfig);
    case 'integration_flows.failed_runs':
      return resolveFailedRuns(widgetConfig);
    case 'integration_flows.latest_run':
      return resolveLatestRun(widgetConfig);
    case 'integration_flows.run_timeline':
      return resolveRunTimeline(widgetConfig);
    default:
      throw new AppError('Unsupported data source', 422, { code: 'UNKNOWN_DATA_SOURCE' });
  }
}

async function resolveHealthSummary(widgetConfig) {
  const where = {};
  if (widgetConfig.parkId) where.parkId = String(widgetConfig.parkId);
  const flows = await IntegrationFlowDefinition.findAll({ where, attributes: ['id', 'enabled', 'scheduleEnabled'] });
  const totalFlows = flows.length;
  const enabledFlows = flows.filter((f) => f.enabled === true).length;
  const scheduledFlows = flows.filter((f) => f.enabled === true && f.scheduleEnabled === true).length;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const failedRuns = await IntegrationFlowRun.count({
    where: { status: 'failed', finishedAt: { [Op.gte]: since } },
  });
  const flowsWithRecentFailure = await IntegrationFlowRun.count({
    where: { status: 'failed', finishedAt: { [Op.gte]: since } },
    distinct: true,
    col: 'flow_id',
  });
  return {
    totalFlows,
    enabledFlows,
    scheduledFlows,
    failedRuns,
    flowsWithRecentFailure,
  };
}

async function resolveFailedRuns(widgetConfig) {
  const limit = Math.min(50, Math.max(1, Number(widgetConfig.limit) || 10));
  const acknowledged = widgetConfig.acknowledged != null ? String(widgetConfig.acknowledged) : 'all';
  const data = await failureInboxService.list({
    limit,
    offset: 0,
    acknowledged,
  });
  return data;
}

async function resolveLatestRun(widgetConfig) {
  const flowId = widgetConfig.flowId != null ? String(widgetConfig.flowId) : null;
  if (!flowId) {
    throw new AppError('widget_config.flowId is required for latest_run', 422, { code: 'INVALID_WIDGET_CONFIG' });
  }
  const runs = await flowService.listRuns(flowId, { limit: 1, offset: 0 });
  const latest = runs[0] || null;
  if (!latest) return { flowId, run: null };
  const detail = await flowService.getRunById(latest.id);
  return { flowId, run: detail };
}

async function resolveRunTimeline(widgetConfig) {
  let runId = widgetConfig.runId != null ? String(widgetConfig.runId) : null;
  const flowId = widgetConfig.flowId != null ? String(widgetConfig.flowId) : null;
  if (!runId && flowId) {
    const runs = await flowService.listRuns(flowId, { limit: 1, offset: 0 });
    runId = runs[0]?.id || null;
  }
  if (!runId) {
    throw new AppError('widget_config.runId or flowId required for run_timeline', 422, {
      code: 'INVALID_WIDGET_CONFIG',
    });
  }
  const run = await flowService.getRunById(runId);
  return {
    runId: run.id,
    flowId: run.flowId,
    status: run.status,
    timeline: run.timeline || [],
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

module.exports = { resolveData, assertIntegrationFlowsAvailable };
