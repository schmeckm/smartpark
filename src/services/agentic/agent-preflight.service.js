'use strict';

const { AgentRun, AgentStep, AgentAction } = require('../../models');
const { AppError } = require('../../utils/app-error');
const { SUPPORTED_SKILLS } = require('./runtime/agent-runner');
const { executeDryRunReadPath } = require('./agent-preflight-dryrun.service');

/** Phase C — checklist + read-path dry-run (same tools as skills, no persisted run) + optional source-run compare. */

function skillPhase(skillId) {
  if (skillId === 'daily_executive_brief') return 'A';
  if (skillId === 'weather_pivot' || skillId === 'ride_down_response') return 'C';
  return 'B';
}

function contextHints(skillId) {
  if (skillId === 'crowd_spike_triage') {
    return ['Optional `crowdEventId` (crowd_events.id) enriches triage context.'];
  }
  if (skillId === 'ride_down_response') {
    return ['Optional `rideId` (park_assets.asset_id) focuses the operational snapshot.'];
  }
  return [];
}

/**
 * @param {{ parkId: string, skillId: string, sourceRunId?: string|null }} params
 */
async function runPreflight(params) {
  const parkId = String(params.parkId || '').trim();
  const skillId = String(params.skillId || '').trim();
  const sourceRunId = params.sourceRunId != null ? String(params.sourceRunId).trim() : '';

  if (!parkId) throw new AppError('parkId is required', 400, { code: 'VALIDATION_ERROR' });
  if (!skillId) throw new AppError('skillId is required', 400, { code: 'VALIDATION_ERROR' });

  const supported = SUPPORTED_SKILLS.has(skillId);
  /** @type {Array<{ id: string, ok: boolean, detail?: string|null }>} */
  const checklist = [];

  checklist.push({
    id: 'skill_registry',
    ok: supported,
    detail: supported ? `${skillId} is registered for execution.` : `Unknown skillId: ${skillId}`,
  });

  /** Read-only tool chain for this skill (validates registry + services; does not write agent rows). */
  const dryRun = await executeDryRunReadPath(parkId, skillId);
  if (!dryRun.skipped) {
    const parts = dryRun.tools.map((t) =>
      t.ok ? `${t.name} OK (${t.ms}ms, ${t.summary || '—'})` : `${t.name} FAIL: ${t.error || 'error'}`
    );
    const detail = parts.join(' · ');
    checklist.push({
      id: 'read_tools_dry_run',
      ok: dryRun.allOk,
      detail: dryRun.allOk
        ? `Read-path dry-run passed (${dryRun.tools.length} tools). ${detail}`
        : `Read-path dry-run: one or more tools failed. ${detail}`,
    });
  }

  checklist.push({
    id: 'human_approval_gate',
    ok: true,
    detail: 'Suggest-mode skills still require inbox approval for mutating actions.',
  });

  let sourceRun = null;
  if (sourceRunId) {
    const row = await AgentRun.findOne({ where: { id: sourceRunId, parkId } });
    if (!row) {
      throw new AppError('Source agent run not found for this park', 404, { code: 'NOT_FOUND' });
    }
    const plain = row.get({ plain: true });
    const [stepCount, actionCount] = await Promise.all([
      AgentStep.count({ where: { runId: sourceRunId } }),
      AgentAction.count({ where: { runId: sourceRunId } }),
    ]);
    const skillMismatch = String(plain.skillId || '') !== skillId;
    checklist.push({
      id: 'source_skill_matches',
      ok: !skillMismatch,
      detail: skillMismatch
        ? `Source run skill is "${plain.skillId}" but preflight targets "${skillId}".`
        : 'Source run skill matches preflight skillId.',
    });
    sourceRun = {
      id: plain.id,
      skillId: plain.skillId,
      status: plain.status,
      mode: plain.mode,
      triggerType: plain.triggerType,
      stepCount,
      actionCount,
      skillMismatch,
    };
  }

  const allOk = checklist.every((c) => c.ok);

  return {
    ok: allOk,
    skillId,
    parkId,
    phase: skillPhase(skillId),
    contextHints: contextHints(skillId),
    checklist,
    sourceRun,
    dryRun,
  };
}

module.exports = { runPreflight, skillPhase, contextHints };
