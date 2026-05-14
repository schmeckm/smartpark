'use strict';

const { AppError } = require('../../../utils/app-error');
const { assertParkScopedTool, mergeToolArgs, assertMutationApproved } = require('./guardrails');

class ToolRegistry {
  constructor() {
    /** @type {Map<string, { name: string, description: string, schema: object, global?: boolean, requiresApproval?: boolean, execute: Function }>} */
    this._tools = new Map();
  }

  /**
   * @param {{
   *   name: string,
   *   description: string,
   *   schema: object,
   *   global?: boolean,
   *   requiresApproval?: boolean,
   *   execute: (context: object, args: object) => Promise<unknown>
   * }} tool
   */
  register(tool) {
    if (!tool?.name || typeof tool.execute !== 'function') {
      throw new Error('Tool must define name and execute');
    }
    this._tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      schema: tool.schema || {},
      global: Boolean(tool.global),
      requiresApproval: Boolean(tool.requiresApproval),
      execute: tool.execute,
    });
  }

  registerMany(tools) {
    for (const t of tools) this.register(t);
  }

  listDefinitions() {
    return [...this._tools.values()].map(({ name, description, schema, global, requiresApproval }) => ({
      name,
      description,
      schema,
      global: Boolean(global),
      requiresApproval: Boolean(requiresApproval),
    }));
  }

  async execute(toolName, context, args = {}) {
    const tool = this._tools.get(toolName);
    if (!tool) {
      throw new AppError(`Unknown tool: ${toolName}`, 400, { code: 'AGENT_UNKNOWN_TOOL' });
    }
    assertParkScopedTool(context, tool);
    assertMutationApproved(context, tool);
    const merged = mergeToolArgs(context, tool, args);
    return tool.execute(context, merged);
  }
}

/** Lazily populated singleton */
let singleton;

function getToolRegistry() {
  if (!singleton) {
    singleton = new ToolRegistry();
    // eslint-disable-next-line global-require
    const { buildDefaultTools } = require('../tools/read/index.tools');
    // eslint-disable-next-line global-require
    const { buildWriteTools } = require('../tools/write/index.tools');
    singleton.registerMany(buildDefaultTools());
    singleton.registerMany(buildWriteTools());
  }
  return singleton;
}

module.exports = { ToolRegistry, getToolRegistry };
