'use strict';

/**
 * Template-only daily brief (no LLM). Persists tool trace via caller-supplied persistence hooks.
 *
 * @param {object} params
 * @param {string} params.runId
 * @param {string} params.parkId
 * @param {string|null} params.parkName
 * @param {import('../runtime/tool-registry').ToolRegistry} params.toolRegistry
 * @param {(row: object) => Promise<import('../../../../models').AgentStep>} params.createStep
 * @param {(row: object) => Promise<import('../../../../models').AgentAction>} params.createAction
 */
async function runDailyExecutiveBrief(params) {
  const { runId, parkId, parkName, toolRegistry, createStep, createAction } = params;
  const toolContext = { parkId, runId };

  let stepIndex = 0;

  await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'plan',
    title: 'Plan read-only executive brief',
    detailJson: {
      skillId: 'daily_executive_brief',
      steps: ['read.dashboard_summary', 'read.forecast_summary', 'read.incidents_list', 'synthesize'],
    },
  });

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
      resultJson: summarizeForAudit(spec.name, output),
      expiresAt: null,
    });
  }

  const markdown = renderMarkdown({
    parkId,
    parkName,
    toolOutputs,
    generatedAt: new Date().toISOString(),
  });

  await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'synthesize',
    title: 'Compose markdown brief',
    detailJson: { generator: 'template_v1', bytes: Buffer.byteLength(markdown, 'utf8') },
  });

  return { markdown, stepCount: stepIndex };
}

function summarizeForAudit(toolName, output) {
  const rec = output && typeof output === 'object' ? /** @type {Record<string, unknown>} */ (output) : {};
  if (toolName === 'read.dashboard_summary') {
    return {
      toolName,
      summary: {
        timestamp: typeof rec.timestamp === 'string' ? rec.timestamp : null,
        rideCardCount: Array.isArray(rec.rides) ? rec.rides.length : null,
      },
    };
  }
  if (toolName === 'read.forecast_summary') {
    return { toolName, summary: { forecastRowCount: typeof rec.count === 'number' ? rec.count : null } };
  }
  if (toolName === 'read.incidents_list') {
    const items = Array.isArray(rec.items) ? rec.items : [];
    const openLike = items.filter((i) => {
      const row = i && typeof i === 'object' ? /** @type {Record<string, unknown>} */ (i) : {};
      return ['OPEN', 'IN_PROGRESS'].includes(String(row.status ?? ''));
    }).length;
    return {
      toolName,
      summary: {
        total: typeof rec.total === 'number' ? rec.total : null,
        pageSampleSize: items.length,
        openOrInProgressInPage: openLike,
      },
    };
  }
  return { toolName, summary: { note: 'no_summarizer' } };
}

function renderMarkdown({ parkId, parkName, toolOutputs, generatedAt }) {
  const dash = toolOutputs['read.dashboard_summary'] && typeof toolOutputs['read.dashboard_summary'] === 'object'
    ? /** @type {Record<string, unknown>} */ (toolOutputs['read.dashboard_summary'])
    : {};
  const fc = toolOutputs['read.forecast_summary'] && typeof toolOutputs['read.forecast_summary'] === 'object'
    ? /** @type {Record<string, unknown>} */ (toolOutputs['read.forecast_summary'])
    : {};
  const inc = toolOutputs['read.incidents_list'] && typeof toolOutputs['read.incidents_list'] === 'object'
    ? /** @type {Record<string, unknown>} */ (toolOutputs['read.incidents_list'])
    : {};

  const lines = [];
  lines.push('# Daily executive brief');
  lines.push('');
  lines.push(`**Park:** ${parkName || '(unknown name)'} (${parkId})`);
  lines.push(`**Generated:** ${generatedAt}`);
  lines.push(`**Skill:** daily_executive_brief`);
  lines.push('');

  lines.push('## Operations snapshot');
  lines.push(`- Facts envelope timestamp: ${typeof dash.timestamp === 'string' ? dash.timestamp : 'n/a'}`);
  lines.push(`- Ride cards in envelope: ${Array.isArray(dash.rides) ? dash.rides.length : 0}`);
  lines.push('');

  lines.push('## Persisted forecasts (PARK scope)');
  lines.push(`- Matching rows: ${typeof fc.count === 'number' ? fc.count : 0}`);
  const fcItems = Array.isArray(fc.items) ? fc.items.slice(0, 8) : [];
  for (const row of fcItems) {
    const r = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
    const pred = r.predictedValue;
    lines.push(
      `- ${String(r.targetMetric ?? '?')} @ ${String(r.horizonMinutes ?? '?')}m → ${pred != null ? String(pred) : 'n/a'}`
    );
  }
  if (!fcItems.length) lines.push('- *(no matching forecast rows)*');
  lines.push('');

  lines.push('## Incidents (recent page)');
  lines.push(`- Total for filters: ${typeof inc.total === 'number' ? inc.total : 0}`);
  const incItems = Array.isArray(inc.items) ? inc.items.slice(0, 12) : [];
  for (const it of incItems) {
    const row = it && typeof it === 'object' ? /** @type {Record<string, unknown>} */ (it) : {};
    lines.push(`- **${String(row.status ?? '?')}** / ${String(row.severity ?? '?')} — ${String(row.title ?? '(untitled)')}`);
  }
  if (!incItems.length) lines.push('- *(none returned on this page)*');
  lines.push('');

  lines.push('---');
  lines.push('*Deterministic template output — Phase A MVP (no LLM).*');

  return lines.join('\n');
}

module.exports = { runDailyExecutiveBrief };
