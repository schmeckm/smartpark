'use strict';

const { AppError } = require('../../../utils/app-error');

function assertParkScopedTool(context, tool) {
  if (tool?.global) return;
  const pid = context?.parkId != null ? String(context.parkId).trim() : '';
  if (!pid) {
    throw new AppError('parkId is required in run context for this tool', 400, { code: 'AGENT_PARK_REQUIRED' });
  }
}

function mergeToolArgs(context, tool, args = {}) {
  const base = args && typeof args === 'object' ? { ...args } : {};
  if (!tool?.global) {
    base.parkId = context.parkId;
  }
  return base;
}

/** Mutating tools must only run with explicit approval context (HTTP approve endpoint). */
function assertMutationApproved(context, tool) {
  if (!tool?.requiresApproval) return;
  if (!context?.applyApproved) {
    throw new AppError('This tool requires an approved agent action before execution', 403, {
      code: 'AGENT_MUTATION_BLOCKED',
    });
  }
  if (!context?.actingUser?.id) {
    throw new AppError('actingUser is required to apply mutating tools', 400, { code: 'AGENT_ACTOR_REQUIRED' });
  }
}

module.exports = { assertParkScopedTool, mergeToolArgs, assertMutationApproved };
