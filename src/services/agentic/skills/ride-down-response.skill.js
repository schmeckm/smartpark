'use strict';

const PROPOSAL_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Phase C — Ride DOWN response (suggest): board snapshot + incidents; proposes incident_open + notify_dispatch.
 *
 * @param {object} params
 * @param {string} params.runId
 * @param {string} params.parkId
 * @param {string|null} params.parkName
 * @param {string|null} params.rideId
 * @param {import('../runtime/tool-registry').ToolRegistry} params.toolRegistry
 * @param {(row: object) => Promise<import('../../../../models').AgentStep>} params.createStep
 * @param {(row: object) => Promise<import('../../../../models').AgentAction>} params.createAction
 */
async function runRideDownResponse(params) {
  const { runId, parkId, parkName, rideId: rideIdFocus, toolRegistry, createStep, createAction } = params;
  const toolContext = { parkId, runId };

  let stepIndex = 0;
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);

  await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'plan',
    title: 'Ride DOWN response (suggest)',
    detailJson: {
      skillId: 'ride_down_response',
      rideId: rideIdFocus || null,
      proposalsExpireAt: expiresAt.toISOString(),
    },
  });

  const snapshotArgs = rideIdFocus ? { focusRideId: rideIdFocus } : {};
  const toolPlan = [
    { name: 'read.rides_operational_snapshot', title: 'Operational ride snapshot', args: snapshotArgs },
    { name: 'read.dashboard_summary', title: 'Operations envelope snapshot', args: {} },
    { name: 'read.incidents_list', title: 'Recent incidents', args: { limit: 20, offset: 0 } },
    { name: 'read.forecast_summary', title: 'Park forecast rows', args: { limit: 10 } },
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

  const snapRaw =
    toolOutputs['read.rides_operational_snapshot'] &&
    typeof toolOutputs['read.rides_operational_snapshot'] === 'object'
      ? /** @type {Record<string, unknown>} */ (toolOutputs['read.rides_operational_snapshot'])
      : {};

  const markdown = renderMarkdown({
    parkId,
    parkName,
    rideIdFocus,
    snap: snapRaw,
    toolOutputs,
    generatedAt: new Date().toISOString(),
  });

  await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'synthesize',
    title: 'Compose ride-down brief',
    detailJson: { generator: 'template_v1', phase: 'C' },
  });

  const downRides = Array.isArray(snapRaw.downRides) ? snapRaw.downRides : [];
  const propose = downRides.length > 0;

  if (!propose) {
    await createStep({
      runId,
      stepIndex: stepIndex++,
      stepType: 'proposal',
      title: 'No mutating proposals (no DOWN rides)',
      detailJson: { actions: [], reason: 'NO_DOWN_RIDES' },
    });
    return { markdown, stepCount: stepIndex };
  }

  const proposalStep = await createStep({
    runId,
    stepIndex: stepIndex++,
    stepType: 'proposal',
    title: 'Pending operator approvals',
    detailJson: {
      actions: ['write.incident_open', 'write.notify_dispatch'],
      expiresAt: expiresAt.toISOString(),
    },
  });

  const incidentPayload = buildIncidentPayload({ parkName, parkId, downRides });
  await createAction({
    runId,
    stepId: proposalStep.id,
    actionType: 'write.incident_open',
    status: 'proposed',
    payloadJson: incidentPayload,
    resultJson: null,
    expiresAt,
  });

  await createAction({
    runId,
    stepId: proposalStep.id,
    actionType: 'write.notify_dispatch',
    status: 'proposed',
    payloadJson: {
      message: [
        `Ride DOWN — ${parkName || parkId}:`,
        downRides
          .slice(0, 5)
          .map((r) => String(r?.rideName || r?.rideId || '?'))
          .join(', '),
        downRides.length > 5 ? ` (+${downRides.length - 5} more)` : '',
        'Approve incident + notify in agent inbox.',
      ]
        .join(' ')
        .trim(),
      severity: incidentPayload.severity === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
    },
    resultJson: null,
    expiresAt,
  });

  return { markdown, stepCount: stepIndex };
}

/**
 * @param {{ parkName?: string|null, parkId: string, downRides: object[] }} p
 */
function buildIncidentPayload({ parkName, parkId, downRides }) {
  const lines = [];
  lines.push(`Automated agent draft — operational DOWN for ${parkName || parkId}.`);
  lines.push('');
  for (const r of downRides) {
    const row = r && typeof r === 'object' ? /** @type {Record<string, unknown>} */ (r) : {};
    lines.push(
      `- **${String(row.rideName || row.rideId || '?')}** (${String(row.rideId || '')}) zone ${String(row.zone || row.zoneId || '—')} · source ${String(row.operationalStatusSource || '—')}`
    );
  }
  lines.push('');
  lines.push('Review asset telemetry on Add-on Board / OEE; coordinate maintenance and guest routing.');
  let description = lines.join('\n');
  if (description.length > 8000) description = `${description.slice(0, 7997)}...`;

  const crit = downRides.some((r) => {
    const row = r && typeof r === 'object' ? /** @type {Record<string, unknown>} */ (r) : {};
    return String(row.boardSeverity || '').toUpperCase() === 'CRITICAL';
  });

  const titleParts = downRides.slice(0, 3).map((r) => {
    const row = r && typeof r === 'object' ? /** @type {Record<string, unknown>} */ (r) : {};
    return String(row.rideName || row.rideId || 'Ride');
  });
  let title = `Ride DOWN — ${titleParts.join(', ')}`;
  if (downRides.length > 3) title += ` (+${downRides.length - 3})`;
  if (title.length > 200) title = `${title.slice(0, 197)}...`;

  return {
    title,
    description,
    severity: crit ? 'CRITICAL' : 'HIGH',
    status: 'OPEN',
  };
}

function renderMarkdown({ parkId, parkName, rideIdFocus, snap, toolOutputs, generatedAt }) {
  const dash =
    toolOutputs['read.dashboard_summary'] && typeof toolOutputs['read.dashboard_summary'] === 'object'
      ? /** @type {Record<string, unknown>} */ (toolOutputs['read.dashboard_summary'])
      : {};
  const inc =
    toolOutputs['read.incidents_list'] && typeof toolOutputs['read.incidents_list'] === 'object'
      ? /** @type {Record<string, unknown>} */ (toolOutputs['read.incidents_list'])
      : {};
  const fc =
    toolOutputs['read.forecast_summary'] && typeof toolOutputs['read.forecast_summary'] === 'object'
      ? /** @type {Record<string, unknown>} */ (toolOutputs['read.forecast_summary'])
      : {};

  const down = Array.isArray(snap.downRides) ? snap.downRides : [];
  const maint = Array.isArray(snap.maintenanceRides) ? snap.maintenanceRides : [];
  const focus = snap.focusRide && typeof snap.focusRide === 'object' ? snap.focusRide : null;

  const lines = [];
  lines.push('# Ride DOWN response (suggest)');
  lines.push('');
  lines.push(`**Park:** ${parkName || '(unknown)'} (${parkId})`);
  lines.push(`**Generated:** ${generatedAt}`);
  if (rideIdFocus) lines.push(`**Focus ride ID:** ${rideIdFocus}`);
  lines.push('');
  lines.push('## Operational snapshot');
  lines.push(`- Total rides on board: ${typeof snap.totalRides === 'number' ? snap.totalRides : 'n/a'}`);
  lines.push(`- **DOWN count:** ${down.length}`);
  lines.push(`- Maintenance count: ${maint.length}`);
  if (typeof snap.hint === 'string') lines.push(`- *${snap.hint}*`);
  lines.push('');
  if (focus) {
    lines.push('## Focus ride');
    const f = /** @type {Record<string, unknown>} */ (focus);
    lines.push(`- Found: ${f.found === false ? 'no' : 'yes'}`);
    lines.push(`- Status: ${f.operationalStatus != null ? String(f.operationalStatus) : 'n/a'}`);
    lines.push(`- Name: ${f.rideName != null ? String(f.rideName) : 'n/a'}`);
    lines.push('');
  }
  lines.push('## Rides marked DOWN');
  if (!down.length) lines.push('- *(none)*');
  else {
    for (const r of down) {
      const row = r && typeof r === 'object' ? /** @type {Record<string, unknown>} */ (r) : {};
      lines.push(
        `- **${String(row.rideName || '?')}** \`${String(row.rideId || '')}\` · zone ${String(row.zone || row.zoneId || '—')} · board severity ${String(row.boardSeverity || '—')} · source ${String(row.operationalStatusSource || '—')}`
      );
    }
  }
  lines.push('');
  lines.push('## Maintenance (context only)');
  if (!maint.length) lines.push('- *(none)*');
  else {
    for (const r of maint.slice(0, 15)) {
      const row = r && typeof r === 'object' ? /** @type {Record<string, unknown>} */ (r) : {};
      lines.push(`- ${String(row.rideName || row.rideId)} (${String(row.rideId || '')})`);
    }
    if (maint.length > 15) lines.push(`- … +${maint.length - 15} more`);
  }
  lines.push('');
  lines.push('## Operations envelope');
  lines.push(`- Facts timestamp: ${typeof dash.timestamp === 'string' ? dash.timestamp : 'n/a'}`);
  lines.push('');
  lines.push('## Recent incidents');
  lines.push(`- Total listed: ${typeof inc.total === 'number' ? inc.total : 0}`);
  lines.push('');
  lines.push('## Forecast rows');
  lines.push(`- Count: ${typeof fc.count === 'number' ? fc.count : 0}`);
  lines.push('');
  lines.push('## Next steps');
  if (down.length) {
    lines.push('- **Proposed:** open incident + dispatch notify stub — approve via `/api/v1/agent/actions`.');
    lines.push('- Coordinate Maintenance / Technical Services; update guest-facing channels when confirmed.');
  } else {
    lines.push('- No DOWN rides detected; no incident/notify proposals for this run.');
  }
  lines.push('');
  lines.push('---');
  lines.push('*Phase C — template narrative; writes require approval.*');

  return lines.join('\n');
}

module.exports = { runRideDownResponse };
