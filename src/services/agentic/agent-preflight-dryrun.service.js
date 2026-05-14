'use strict';

const { randomUUID } = require('node:crypto');
const { getToolRegistry } = require('./runtime/tool-registry');

/**
 * Skill-aligned read-only tool sequence (matches agent skills’ first data path, smaller limits).
 * Executes under a synthetic run id — no `agent_runs` row; validates registry + DB/service wiring.
 *
 * @param {string} skillId
 * @returns {Array<{ name: string, args: object }>}
 */
function dryRunPlanForSkill(skillId) {
  switch (skillId) {
    case 'daily_executive_brief':
      return [
        { name: 'read.dashboard_summary', args: {} },
        { name: 'read.forecast_summary', args: { limit: 5 } },
        { name: 'read.incidents_list', args: { limit: 5, offset: 0 } },
      ];
    case 'crowd_spike_triage':
      return [
        { name: 'read.dashboard_summary', args: {} },
        { name: 'read.forecast_summary', args: { limit: 10 } },
        { name: 'read.incidents_list', args: { limit: 10, offset: 0 } },
      ];
    case 'mapping_assistant':
      return [
        { name: 'read.dashboard_summary', args: {} },
        { name: 'read.external_mappings_needs_review', args: { limit: 20 } },
        { name: 'read.incidents_list', args: { limit: 10, offset: 0 } },
      ];
    case 'weather_pivot':
      return [
        { name: 'read.dashboard_summary', args: {} },
        { name: 'read.weather_snapshot', args: {} },
        { name: 'read.forecast_summary', args: { limit: 10 } },
        { name: 'read.incidents_list', args: { limit: 8, offset: 0 } },
      ];
    case 'ride_down_response':
      return [
        { name: 'read.rides_operational_snapshot', args: {} },
        { name: 'read.dashboard_summary', args: {} },
        { name: 'read.incidents_list', args: { limit: 10, offset: 0 } },
      ];
    default:
      return [];
  }
}

/**
 * @param {string} toolName
 * @param {unknown} output
 * @returns {string}
 */
function summarizeToolOutput(toolName, output) {
  if (output == null) return 'null';
  if (typeof output !== 'object') return String(output).slice(0, 80);
  const o = /** @type {Record<string, unknown>} */ (output);
  if (toolName === 'read.forecast_summary') return `count=${Number(o.count) || 0}`;
  if (toolName === 'read.incidents_list') {
    const items = o.items;
    return `items=${Array.isArray(items) ? items.length : '?'}`;
  }
  if (toolName === 'read.dashboard_summary') return 'envelope=ok';
  if (toolName === 'read.weather_snapshot') {
    const obs = o.observation;
    if (obs && typeof obs === 'object') return 'observation=present';
    return `scope=${o.scope != null ? String(o.scope) : '?'}`;
  }
  if (toolName === 'read.rides_operational_snapshot') {
    return `rides=${o.totalRides != null ? Number(o.totalRides) : '?'} down=${o.downCount != null ? Number(o.downCount) : '?'}`;
  }
  if (toolName === 'read.external_mappings_needs_review') {
    return `needs_review=${Number(o.count) || 0}`;
  }
  return 'ok';
}

/**
 * @param {string} parkId
 * @param {string} skillId
 * @returns {Promise<{ allOk: boolean, skipped: boolean, tools: Array<{ name: string, ok: boolean, ms: number, summary?: string, error?: string }> }>}
 */
async function executeDryRunReadPath(parkId, skillId) {
  const plan = dryRunPlanForSkill(skillId);
  if (!plan.length) {
    return { allOk: true, skipped: true, tools: [] };
  }

  const registry = getToolRegistry();
  const context = { parkId, runId: `preflight-dry-run:${randomUUID()}` };

  /** @type {Array<{ name: string, ok: boolean, ms: number, summary?: string, error?: string }>} */
  const tools = [];
  let allOk = true;

  for (const spec of plan) {
    const started = Date.now();
    try {
      const out = await registry.execute(spec.name, context, spec.args);
      tools.push({
        name: spec.name,
        ok: true,
        ms: Date.now() - started,
        summary: summarizeToolOutput(spec.name, out),
      });
    } catch (e) {
      allOk = false;
      const msg = e && typeof e === 'object' && 'message' in e ? String(/** @type {{ message?: string }} */ (e).message) : String(e);
      tools.push({
        name: spec.name,
        ok: false,
        ms: Date.now() - started,
        error: msg.slice(0, 400),
      });
    }
  }

  return { allOk, skipped: false, tools };
}

module.exports = { executeDryRunReadPath, dryRunPlanForSkill, summarizeToolOutput };
