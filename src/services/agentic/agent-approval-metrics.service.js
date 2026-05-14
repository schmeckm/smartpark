'use strict';

const { Op, QueryTypes } = require('sequelize');
const { AgentAction, AgentRun } = require('../../models');

const WRITE_ACTION_PREFIX = { [Op.like]: 'write.%' };

/**
 * Resolved write proposals (mutating tool proposals), excluding still-pending.
 * @param {string} parkId
 * @param {{ skillId?: string|null, sinceDays?: number }} opts
 */
async function getApprovalSummaryForPark(parkId, opts = {}) {
  const sinceDays = Math.min(365, Math.max(1, Number(opts.sinceDays) || 30));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - sinceDays);

  const runWhere = { parkId };
  if (opts.skillId) runWhere.skillId = String(opts.skillId);

  const baseInclude = {
    model: AgentRun,
    as: 'run',
    attributes: [],
    required: true,
    where: runWhere,
  };

  const actionWhereBase = {
    actionType: WRITE_ACTION_PREFIX,
    createdAt: { [Op.gte]: since },
  };

  const [applied, rejected, failed, expired, pending] = await Promise.all([
    AgentAction.count({ include: [baseInclude], where: { ...actionWhereBase, status: 'applied' } }),
    AgentAction.count({ include: [baseInclude], where: { ...actionWhereBase, status: 'rejected' } }),
    AgentAction.count({ include: [baseInclude], where: { ...actionWhereBase, status: 'failed' } }),
    AgentAction.count({ include: [baseInclude], where: { ...actionWhereBase, status: 'expired' } }),
    AgentAction.count({ include: [baseInclude], where: { ...actionWhereBase, status: 'proposed' } }),
  ]);

  const decided = applied + rejected + failed + expired;
  const approvalRate = decided > 0 ? Math.round((applied / decided) * 10000) / 10000 : null;

  const sequelize = AgentRun.sequelize;
  /** @type {Array<{ skill_id: string, status: string, cnt: string|number }>} */
  const rows = await sequelize.query(
    `
    SELECT r.skill_id AS skill_id, a.status, COUNT(*)::int AS cnt
    FROM agent_actions a
    INNER JOIN agent_runs r ON r.id = a.run_id
    WHERE r.park_id = :parkId
      AND a.action_type LIKE 'write.%'
      AND a.created_at >= :since
      ${opts.skillId ? 'AND r.skill_id = :skillId' : ''}
    GROUP BY r.skill_id, a.status
    ORDER BY r.skill_id, a.status
    `,
    {
      replacements: {
        parkId,
        since,
        ...(opts.skillId ? { skillId: String(opts.skillId) } : {}),
      },
      type: QueryTypes.SELECT,
    }
  );

  /** @type {Record<string, Record<string, number>>} */
  const bySkill = {};
  for (const row of rows) {
    const sid = String(row.skill_id || '');
    const st = String(row.status || '');
    const c = Number(row.cnt) || 0;
    if (!bySkill[sid]) bySkill[sid] = {};
    bySkill[sid][st] = c;
  }

  return {
    parkId,
    skillFilter: opts.skillId ? String(opts.skillId) : null,
    windowDays: sinceDays,
    since: since.toISOString(),
    applied,
    rejected,
    failed,
    expired,
    pending,
    decided,
    approvalRate,
    bySkill,
  };
}

module.exports = { getApprovalSummaryForPark };
