'use strict';

const { CrowdEvent } = require('../../../models');

const PROPOSAL_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Phase B — Suggest-mode skill: read-only snapshot + **proposed** mutating actions (approval required).
 *
 * @param {object} params
 * @param {string} params.runId
 * @param {string} params.parkId
 * @param {string|null} params.parkName
 * @param {string|null} params.crowdEventId
 * @param {import('../runtime/tool-registry').ToolRegistry} params.toolRegistry
 * @param {(row: object) => Promise<import('../../../../models').AgentStep>} params.createStep
 * @param {(row: object) => Promise<import('../../../../models').AgentAction>} params.createAction
 */
async function runCrowdSpikeTriage(params) {
  const { runId, parkId, parkName, crowdEventId, toolRegistry, createStep, createAction } = params;
  const toolContext = { parkId, runId };

  let stepIndex = 0;
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);

  await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'plan',
    title: 'Crowd spike triage (suggest mode)',
    detailJson: {
      skillId: 'crowd_spike_triage',
      crowdEventId: crowdEventId || null,
      proposalsExpireAt: expiresAt.toISOString(),
    },
  });

  let eventHint = null;
  if (crowdEventId) {
    const ev = await CrowdEvent.findByPk(crowdEventId, {
      include: [{ association: 'zone', attributes: ['id', 'name'] }],
    });
    if (ev) {
      const plain = ev.get({ plain: true });
      eventHint = {
        id: plain.id,
        eventType: plain.eventType,
        crowdLevel: plain.crowdLevel,
        severity: plain.severity,
        zone: plain.zone ? { id: plain.zone.id, name: plain.zone.name } : null,
      };
    }
  }

  const toolPlan = [
    { name: 'read.dashboard_summary', title: 'Read dashboard summary', args: {} },
    { name: 'read.forecast_summary', title: 'Read forecast summary', args: { limit: 20 } },
    { name: 'read.incidents_list', title: 'Read incidents list', args: { limit: 25, offset: 0 } },
  ];

  /** @type {Record<string, unknown>} */
  const toolOutputs = {};

  for (const spec of toolPlan) {
    const stepRow = await createStep({
      runId,
      stepIndex: stepIndex++,
      stepType: 'tool',
      title: spec.title,
      detailJson: { toolName: spec.name, args: spec.args },
    });

    const output = await toolRegistry.execute(spec.name, toolContext, spec.args);
    toolOutputs[spec.name] = output;

    await createAction({
      runId,
      stepId: stepRow.id,
      actionType: 'tool.invoke',
      status: 'completed',
      payloadJson: { toolName: spec.name, args: spec.args },
      resultJson: { ok: true },
      expiresAt: null,
    });
  }

  const markdown = renderMarkdown({
    parkId,
    parkName,
    crowdEventId,
    eventHint,
    toolOutputs,
    generatedAt: new Date().toISOString(),
  });

  await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'synthesize',
    title: 'Compose triage narrative',
    detailJson: { generator: 'template_v1', phase: 'B' },
  });

  const proposalStep = await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'proposal',
    title: 'Pending operator approvals',
    detailJson: {
      actions: ['write.recommendations_score_batch', 'write.notify_dispatch'],
      expiresAt: expiresAt.toISOString(),
    },
  });

  await createAction({
    runId,
    stepId: proposalStep.id,
    actionType: 'write.recommendations_score_batch',
    status: 'proposed',
    payloadJson: {},
    resultJson: null,
    expiresAt,
  });

  await createAction({
    runId,
    stepId: proposalStep.id,
    actionType: 'write.notify_dispatch',
    status: 'proposed',
    payloadJson: {
      message: buildNotifyMessage({ parkName, eventHint, markdown }),
      severity: eventHint && Number(eventHint.severity) >= 4 ? 'HIGH' : 'MEDIUM',
    },
    resultJson: null,
    expiresAt,
  });

  return { markdown, stepCount: stepIndex };
}

function buildNotifyMessage({ parkName, eventHint }) {
  const parts = [`Agent triage — ${parkName || 'park'}:`];
  if (eventHint?.zone?.name) parts.push(`Zone ${eventHint.zone.name}`);
  if (eventHint?.eventType) parts.push(`Event ${eventHint.eventType}`);
  if (eventHint?.crowdLevel != null) parts.push(`Crowd ${eventHint.crowdLevel}`);
  parts.push('Review pending agent actions in /agent/actions.');
  return parts.join(' · ');
}

function renderMarkdown({ parkId, parkName, crowdEventId, eventHint, toolOutputs, generatedAt }) {
  const dash =
    toolOutputs['read.dashboard_summary'] && typeof toolOutputs['read.dashboard_summary'] === 'object'
      ? /** @type {Record<string, unknown>} */ (toolOutputs['read.dashboard_summary'])
      : {};
  const fc =
    toolOutputs['read.forecast_summary'] && typeof toolOutputs['read.forecast_summary'] === 'object'
      ? /** @type {Record<string, unknown>} */ (toolOutputs['read.forecast_summary'])
      : {};
  const inc =
    toolOutputs['read.incidents_list'] && typeof toolOutputs['read.incidents_list'] === 'object'
      ? /** @type {Record<string, unknown>} */ (toolOutputs['read.incidents_list'])
      : {};

  const lines = [];
  lines.push('# Crowd spike triage (suggest)');
  lines.push('');
  lines.push(`**Park:** ${parkName || '(unknown)'} (${parkId})`);
  lines.push(`**Generated:** ${generatedAt}`);
  if (crowdEventId) lines.push(`**Crowd event ID:** ${crowdEventId}`);
  lines.push('');
  if (eventHint) {
    lines.push('## Trigger context');
    lines.push(`- Type: ${String(eventHint.eventType ?? 'n/a')}`);
    lines.push(`- Severity: ${String(eventHint.severity ?? 'n/a')}`);
    lines.push(`- Crowd level: ${String(eventHint.crowdLevel ?? 'n/a')}`);
    lines.push(`- Zone: ${eventHint.zone ? String(eventHint.zone.name) : 'n/a'}`);
    lines.push('');
  }

  lines.push('## Operations snapshot');
  lines.push(`- Facts timestamp: ${typeof dash.timestamp === 'string' ? dash.timestamp : 'n/a'}`);
  lines.push(`- Ride cards: ${Array.isArray(dash.rides) ? dash.rides.length : 0}`);
  lines.push('');
  lines.push('## Forecast rows (PARK scope)');
  lines.push(`- Count: ${typeof fc.count === 'number' ? fc.count : 0}`);
  lines.push('');
  lines.push('## Incidents (recent)');
  lines.push(`- Total: ${typeof inc.total === 'number' ? inc.total : 0}`);
  lines.push('');
  lines.push('## Next steps');
  lines.push('- Two mutating actions are **proposed** (score batch + notify stub). Approve or reject via `/api/v1/agent/actions`.');
  lines.push('');
  lines.push('---');
  lines.push('*Phase B — template narrative; mutating tools require explicit approval.*');

  return lines.join('\n');
}

module.exports = { runCrowdSpikeTriage };
