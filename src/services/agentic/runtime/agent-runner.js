'use strict';

const { sequelize, AgentRun, AgentStep, AgentAction, Park } = require('../../../models');
const { AppError } = require('../../../utils/app-error');
const { logger } = require('../../../utils/logger');
const { AuditLogService } = require('../../audit-log.service');
const AUDIT = require('../../../constants/audit-actions');
const { getToolRegistry } = require('./tool-registry');
const { runDailyExecutiveBrief } = require('../skills/daily-executive-brief.skill');
const { runCrowdSpikeTriage } = require('../skills/crowd-spike-triage.skill');
const { runMappingAssistant } = require('../skills/mapping-assistant.skill');
const { runWeatherPivot } = require('../skills/weather-pivot.skill');
const { runRideDownResponse } = require('../skills/ride-down-response.skill');

const auditLogService = new AuditLogService();

const SUPPORTED_SKILLS = new Set([
  'daily_executive_brief',
  'crowd_spike_triage',
  'mapping_assistant',
  'weather_pivot',
  'ride_down_response',
]);

const SKILL_MODE = {
  daily_executive_brief: 'auto',
  crowd_spike_triage: 'suggest',
  mapping_assistant: 'suggest',
  weather_pivot: 'suggest',
  ride_down_response: 'suggest',
};

function metaPhaseForSkill(skillId) {
  if (skillId === 'daily_executive_brief') return 'A';
  if (skillId === 'weather_pivot' || skillId === 'ride_down_response') return 'C';
  return 'B';
}

/**
 * @param {{
 *   skillId: string,
 *   parkId: string,
 *   userId: string|null,
 *   triggerType: string,
 *   crowdEventId?: string|null,
 *   rideId?: string|null,
 *   replayOfRunId?: string|null,
 *   toolRegistry?: import('./tool-registry').ToolRegistry
 * }} params
 */
async function executeAgentSkill(params) {
  const { skillId, parkId, userId, triggerType, crowdEventId, rideId, replayOfRunId } = params;
  const toolRegistry = params.toolRegistry || getToolRegistry();

  if (!SUPPORTED_SKILLS.has(skillId)) {
    throw new AppError(`Unsupported skillId: ${skillId}`, 400, { code: 'AGENT_UNSUPPORTED_SKILL' });
  }

  const park = await Park.findByPk(parkId, { attributes: ['id', 'name'] });
  if (!park) {
    throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
  }

  const mode = SKILL_MODE[skillId] || 'auto';

  const run = await AgentRun.create({
    parkId,
    skillId,
    mode,
    triggerType: triggerType || 'manual',
    triggerRef: replayOfRunId
      ? `replay:${String(replayOfRunId)}`
      : crowdEventId
        ? String(crowdEventId)
        : null,
    status: 'running',
    startedAt: new Date(),
    inputJson: {
      skillId,
      parkId,
      triggerType: triggerType || 'manual',
      crowdEventId: crowdEventId || null,
      rideId: rideId || null,
      replayOfRunId: replayOfRunId || null,
    },
    metaJson: {
      generator: 'template_v1',
      phase: metaPhaseForSkill(skillId),
      ...(replayOfRunId ? { replayOfRunId: String(replayOfRunId) } : {}),
    },
    createdByUserId: userId,
  });

  await auditLogService.log({
    action: AUDIT.AGENT_RUN_START,
    entityType: 'agent_run',
    entityId: run.id,
    newValue: { skillId, parkId, triggerType, mode },
    userId,
  });

  const t = await sequelize.transaction();

  try {
    const createStep = (row) =>
      AgentStep.create(
        {
          runId: run.id,
          stepIndex: row.stepIndex,
          stepType: row.stepType,
          title: row.title ?? null,
          detailJson: row.detailJson ?? {},
        },
        { transaction: t }
      );

    const createAction = (row) =>
      AgentAction.create(
        {
          runId: run.id,
          stepId: row.stepId ?? null,
          actionType: row.actionType,
          status: row.status,
          payloadJson: row.payloadJson ?? {},
          resultJson: row.resultJson ?? null,
          expiresAt: row.expiresAt ?? null,
          targetType: row.targetType ?? null,
          targetId: row.targetId ?? null,
          approvedByUserId: row.approvedByUserId ?? null,
          approvedAt: row.approvedAt ?? null,
          rejectedReason: row.rejectedReason ?? null,
        },
        { transaction: t }
      );

    let markdown = '';
    if (skillId === 'daily_executive_brief') {
      const out = await runDailyExecutiveBrief({
        runId: run.id,
        parkId,
        parkName: park.name,
        toolRegistry,
        createStep,
        createAction,
      });
      markdown = out.markdown;
    } else if (skillId === 'crowd_spike_triage') {
      const out = await runCrowdSpikeTriage({
        runId: run.id,
        parkId,
        parkName: park.name,
        crowdEventId: crowdEventId || null,
        toolRegistry,
        createStep,
        createAction,
      });
      markdown = out.markdown;
    } else if (skillId === 'mapping_assistant') {
      const out = await runMappingAssistant({
        runId: run.id,
        parkId,
        parkName: park.name,
        toolRegistry,
        createStep,
        createAction,
      });
      markdown = out.markdown;
    } else if (skillId === 'weather_pivot') {
      const out = await runWeatherPivot({
        runId: run.id,
        parkId,
        parkName: park.name,
        toolRegistry,
        createStep,
        createAction,
      });
      markdown = out.markdown;
    } else if (skillId === 'ride_down_response') {
      const out = await runRideDownResponse({
        runId: run.id,
        parkId,
        parkName: park.name,
        rideId: rideId || null,
        toolRegistry,
        createStep,
        createAction,
      });
      markdown = out.markdown;
    }

    await run.update(
      {
        status: 'succeeded',
        finishedAt: new Date(),
        outputSummary: markdown,
        errorMessage: null,
      },
      { transaction: t }
    );

    await t.commit();

    await auditLogService.log({
      action: AUDIT.AGENT_RUN_COMPLETE,
      entityType: 'agent_run',
      entityId: run.id,
      newValue: { skillId, parkId, status: 'succeeded', mode },
      userId,
    });

    return run.id;
  } catch (err) {
    await t.rollback();
    logger.error({ err, skillId, parkId, runId: run.id }, 'agent skill execution failed');

    await run.update({
      status: 'failed',
      finishedAt: new Date(),
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    await auditLogService.log({
      action: AUDIT.AGENT_RUN_FAILED,
      entityType: 'agent_run',
      entityId: run.id,
      newValue: { skillId, parkId, message: err instanceof Error ? err.message : String(err) },
      userId,
    });

    throw err;
  }
}

module.exports = { executeAgentSkill, SUPPORTED_SKILLS };
