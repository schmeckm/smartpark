'use strict';

const PROPOSAL_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Phase B — Mapping assistant: surfaces NEEDS_REVIEW mappings; proposes audit-log notify only (no auto-mapping writes).
 *
 * @param {object} params
 * @param {string} params.runId
 * @param {string} params.parkId
 * @param {string|null} params.parkName
 * @param {import('../runtime/tool-registry').ToolRegistry} params.toolRegistry
 * @param {(row: object) => Promise<import('../../../../models').AgentStep>} params.createStep
 * @param {(row: object) => Promise<import('../../../../models').AgentAction>} params.createAction
 */
async function runMappingAssistant(params) {
  const { runId, parkId, parkName, toolRegistry, createStep, createAction } = params;
  const toolContext = { parkId, runId };

  let stepIndex = 0;
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);

  await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'plan',
    title: 'Mapping assistant (suggest)',
    detailJson: {
      skillId: 'mapping_assistant',
      proposalsExpireAt: expiresAt.toISOString(),
    },
  });

  const toolPlan = [
    { name: 'read.dashboard_summary', title: 'Operations envelope snapshot', args: {} },
    { name: 'read.external_mappings_needs_review', title: 'NEEDS_REVIEW mappings', args: { limit: 50 } },
    { name: 'read.incidents_list', title: 'Recent incidents', args: { limit: 15, offset: 0 } },
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

  const mapSummary = /** @type {{ count?: number, items?: object[], scopedByParkExternalId?: boolean }} */ (
    toolOutputs['read.external_mappings_needs_review'] || {}
  );
  const markdown = renderMarkdown({
    parkId,
    parkName,
    mapSummary,
    generatedAt: new Date().toISOString(),
  });

  await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'synthesize',
    title: 'Compose mapping brief',
    detailJson: { generator: 'template_v1', phase: 'B' },
  });

  const proposalStep = await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'proposal',
    title: 'Pending acknowledgement',
    detailJson: {
      actions: ['write.notify_dispatch'],
      note: 'Apply mappings via Integrations UI — approve only logs intent.',
      expiresAt: expiresAt.toISOString(),
    },
  });

  const cnt = typeof mapSummary.count === 'number' ? mapSummary.count : 0;
  await createAction({
    runId,
    stepId: proposalStep.id,
    actionType: 'write.notify_dispatch',
    status: 'proposed',
    payloadJson: {
      message: [
        `Mapping backlog (${parkName || parkId}):`,
        `${cnt} NEEDS_REVIEW mapping row(s)`,
        mapSummary.scopedByParkExternalId ? '(scoped by park external id)' : '(park external id unset — list may be broad)',
        'Resolve in Integrations → mappings.',
      ].join(' '),
      severity: cnt > 0 ? 'MEDIUM' : 'LOW',
    },
    resultJson: null,
    expiresAt,
  });

  return { markdown, stepCount: stepIndex };
}

function renderMarkdown({ parkId, parkName, mapSummary, generatedAt }) {
  const lines = [];
  lines.push('# Mapping assistant (suggest)');
  lines.push('');
  lines.push(`**Park:** ${parkName || '(unknown)'} (${parkId})`);
  lines.push(`**Generated:** ${generatedAt}`);
  lines.push('');
  lines.push('## NEEDS_REVIEW mappings');
  lines.push(`- Rows returned: ${typeof mapSummary.count === 'number' ? mapSummary.count : 0}`);
  lines.push(
    `- Scoped by park external id: ${mapSummary.scopedByParkExternalId === true ? 'yes' : mapSummary.scopedByParkExternalId === false ? 'no' : 'n/a'}`
  );
  const items = Array.isArray(mapSummary.items) ? mapSummary.items.slice(0, 20) : [];
  for (const row of items) {
    const r = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
    lines.push(
      `- **${String(r.provider ?? '?')}** ${String(r.externalEntityName ?? r.externalEntityId ?? '?')} → internal ${String(r.internalEntityType ?? '—')} ${String(r.internalEntityId ?? '—')} (conf ${r.confidence != null ? String(r.confidence) : 'n/a'})`
    );
  }
  if (!items.length) lines.push('- *(none returned)*');
  lines.push('');
  lines.push('## Operator guidance');
  lines.push('- Review each mapping in the Integrations / MDM flows; do **not** auto-apply without validation.');
  lines.push('- Approving the pending notify action only adds an **audit entry** (Phase B stub).');
  lines.push('');
  lines.push('---');
  lines.push('*Phase B — template narrative.*');

  return lines.join('\n');
}

module.exports = { runMappingAssistant };
