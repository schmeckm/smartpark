'use strict';

module.exports = {
  key: 'GENERATE_OUTPUT_FILE',
  nodeType: 'output',
  displayName: 'Generate Output File',
  category: 'Output',
  description:
    'Placeholder for governed file export (JSON/CSV/PDF). MVP returns metadata only — no artifact storage.',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
      filenameTemplate: { type: 'string', default: 'export-{{timestamp}}' },
    },
  },
  inputSchema: {},
  outputSchema: {},
  async execute(context) {
    const cfg = context.nodeConfig && typeof context.nodeConfig === 'object' ? context.nodeConfig : {};
    const format = cfg.format != null ? String(cfg.format) : 'json';
    const filenameTemplate =
      cfg.filenameTemplate != null ? String(cfg.filenameTemplate) : 'export-{{timestamp}}';

    const upstream =
      context.payload !== undefined
        ? context.payload
        : context.input !== undefined
          ? context.input
          : null;

    const base =
      upstream && typeof upstream === 'object' && !Array.isArray(upstream)
        ? { ...upstream }
        : { data: upstream };

    return {
      success: true,
      payload: {
        ...base,
        fileOutput: {
          generated: false,
          reason: 'File generation not implemented in this MVP',
          format,
          filenameTemplate,
        },
      },
    };
  },
};
