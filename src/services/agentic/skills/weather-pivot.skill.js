'use strict';

const PROPOSAL_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Phase C — Weather pivot (suggest): combines weather snapshot, forecasts, incidents; proposes notify only.
 *
 * @param {object} params
 * @param {string} params.runId
 * @param {string} params.parkId
 * @param {string|null} params.parkName
 * @param {import('../runtime/tool-registry').ToolRegistry} params.toolRegistry
 * @param {(row: object) => Promise<import('../../../../models').AgentStep>} params.createStep
 * @param {(row: object) => Promise<import('../../../../models').AgentAction>} params.createAction
 */
async function runWeatherPivot(params) {
  const { runId, parkId, parkName, toolRegistry, createStep, createAction } = params;
  const toolContext = { parkId, runId };

  let stepIndex = 0;
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);

  await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'plan',
    title: 'Weather pivot (suggest)',
    detailJson: {
      skillId: 'weather_pivot',
      proposalsExpireAt: expiresAt.toISOString(),
    },
  });

  const toolPlan = [
    { name: 'read.dashboard_summary', title: 'Operations envelope snapshot', args: {} },
    { name: 'read.weather_snapshot', title: 'Latest weather observation', args: {} },
    { name: 'read.forecast_summary', title: 'Park forecast rows', args: { limit: 15 } },
    { name: 'read.incidents_list', title: 'Recent incidents', args: { limit: 12, offset: 0 } },
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

  const wxRaw =
    toolOutputs['read.weather_snapshot'] && typeof toolOutputs['read.weather_snapshot'] === 'object'
      ? /** @type {Record<string, unknown>} */ (toolOutputs['read.weather_snapshot'])
      : {};

  const markdown = renderMarkdown({
    parkId,
    parkName,
    wx: wxRaw,
    toolOutputs,
    generatedAt: new Date().toISOString(),
  });

  await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'synthesize',
    title: 'Compose weather pivot brief',
    detailJson: { generator: 'template_v1', phase: 'C' },
  });

  const hintLevel = weatherSeverityHint(wxRaw.observation);
  const proposalStep = await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'proposal',
    title: 'Pending acknowledgement',
    detailJson: {
      actions: ['write.notify_dispatch'],
      expiresAt: expiresAt.toISOString(),
      hintLevel,
    },
  });

  await createAction({
    runId,
    stepId: proposalStep.id,
    actionType: 'write.notify_dispatch',
    status: 'proposed',
    payloadJson: {
      message: buildNotifyLine({ parkName, parkId, wx: wxRaw, hintLevel }),
      severity: hintLevel === 'HIGH' ? 'HIGH' : hintLevel === 'MEDIUM' ? 'MEDIUM' : 'LOW',
    },
    resultJson: null,
    expiresAt,
  });

  return { markdown, stepCount: stepIndex };
}

/**
 * @param {unknown} obs
 * @returns {'HIGH'|'MEDIUM'|'LOW'}
 */
function weatherSeverityHint(obs) {
  if (!obs || typeof obs !== 'object') return 'LOW';
  const o = /** @type {Record<string, unknown>} */ (obs);
  const rain = o.rainMm != null ? Number(o.rainMm) : 0;
  const rp = o.rainProbabilityPercent != null ? Number(o.rainProbabilityPercent) : 0;
  const cond = String(o.condition || '').toUpperCase();
  const stormish = /STORM|THUNDER|HAIL|SNOW|BLIZZARD/.test(cond);
  if (stormish || rain >= 2 || rp >= 70) return 'HIGH';
  if (rain > 0 || rp >= 40 || /RAIN|DRIZZLE|SHOWER/.test(cond)) return 'MEDIUM';
  return 'LOW';
}

function buildNotifyLine({ parkName, parkId, wx, hintLevel }) {
  const scope = wx?.scope != null ? String(wx.scope) : '';
  const obs = wx?.observation && typeof wx.observation === 'object' ? wx.observation : null;
  const parts = [`Weather pivot — ${parkName || parkId}:`];
  if (obs && typeof obs === 'object') {
    const o = /** @type {Record<string, unknown>} */ (obs);
    if (o.condition) parts.push(String(o.condition));
    if (o.temperatureC != null) parts.push(`${o.temperatureC}°C`);
    if (o.rainProbabilityPercent != null) parts.push(`rainProb ${o.rainProbabilityPercent}%`);
  }
  parts.push(`scope=${scope || 'n/a'}`);
  parts.push(`hint=${hintLevel}`);
  parts.push('Review playbook in agent run output.');
  return parts.join(' ');
}

function renderMarkdown({ parkId, parkName, wx, toolOutputs, generatedAt }) {
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

  const obs =
    wx?.observation && typeof wx.observation === 'object'
      ? /** @type {Record<string, unknown>} */ (wx.observation)
      : null;
  const hintLevel = weatherSeverityHint(obs);

  const lines = [];
  lines.push('# Weather pivot (suggest)');
  lines.push('');
  lines.push(`**Park:** ${parkName || '(unknown)'} (${parkId})`);
  lines.push(`**Generated:** ${generatedAt}`);
  lines.push('');
  lines.push('## Weather');
  lines.push(`- Scope: ${typeof wx.scope === 'string' ? wx.scope : 'n/a'}`);
  if (typeof wx.hint === 'string' && wx.hint) lines.push(`- Note: ${wx.hint}`);
  if (obs) {
    lines.push(`- Condition: ${obs.condition != null ? String(obs.condition) : 'n/a'}`);
    lines.push(`- Temperature: ${obs.temperatureC != null ? `${obs.temperatureC} °C` : 'n/a'}`);
    lines.push(`- Rain (mm): ${obs.rainMm != null ? String(obs.rainMm) : 'n/a'}`);
    lines.push(`- Rain probability: ${obs.rainProbabilityPercent != null ? `${obs.rainProbabilityPercent}%` : 'n/a'}`);
    lines.push(`- Wind: ${obs.windKmh != null ? `${obs.windKmh} km/h` : 'n/a'}`);
    lines.push(`- Observed at: ${obs.observedAt != null ? String(obs.observedAt) : 'n/a'}`);
  } else {
    lines.push('- *(no observation)*');
  }
  lines.push(`- **Severity hint:** ${hintLevel}`);
  lines.push('');
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
  lines.push('## Operator playbook (template)');
  if (hintLevel === 'HIGH' || hintLevel === 'MEDIUM') {
    lines.push('- Pre-brief indoor venues / shows; expect outdoor throughput dip.');
    lines.push('- Shift guest routing messaging toward covered routes and indoor assets.');
    lines.push('- Align Security / Guest Services on slippery surfaces and queue umbrellas.');
  } else {
    lines.push('- Conditions mild — maintain standard routing; monitor forecasts if horizon extends.');
  }
  lines.push('- Approving **notify_dispatch** only records audit intent in Phase B/C stub.');
  lines.push('');
  lines.push('---');
  lines.push('*Phase C — template narrative; no automatic staffing writes.*');

  return lines.join('\n');
}

module.exports = { runWeatherPivot };
