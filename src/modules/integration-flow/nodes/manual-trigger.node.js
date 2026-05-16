'use strict';

module.exports = {
  key: 'MANUAL_TRIGGER',
  nodeType: 'trigger',
  displayName: 'Manual Trigger',
  category: 'Trigger',
  description: 'Starts a flow manually with caller-provided input payload.',
  configSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  inputSchema: {},
  outputSchema: {},
  async execute(context) {
    const input =
      context.payload !== undefined
        ? context.payload
        : context.input !== undefined
          ? context.input
          : context.flowInput;
    return {
      success: true,
      payload: input && typeof input === 'object' ? { ...input } : {},
    };
  },
};
