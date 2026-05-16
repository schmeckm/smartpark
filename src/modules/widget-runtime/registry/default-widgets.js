'use strict';

/** Built-in widget registry seeds (governed component_name whitelist). */
const DEFAULT_WIDGETS = Object.freeze([
  {
    widgetKey: 'FLOW_HEALTH_CARD',
    displayName: 'Flow health',
    category: 'Integration Flows',
    description: 'Operational counts for integration flow definitions and recent failures.',
    componentName: 'FlowHealthCardWidget',
    configSchema: {
      type: 'object',
      properties: {
        parkId: { type: 'string', format: 'uuid' },
      },
      additionalProperties: false,
    },
  },
  {
    widgetKey: 'FAILED_RUNS_CARD',
    displayName: 'Failed runs',
    category: 'Integration Flows',
    description: 'Latest failed integration flow runs with retry and inbox context.',
    componentName: 'FailedRunsCardWidget',
    configSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        acknowledged: { type: 'string', enum: ['all', 'yes', 'no'], default: 'all' },
      },
      additionalProperties: false,
    },
  },
  {
    widgetKey: 'FLOW_RUN_TIMELINE_CARD',
    displayName: 'Flow run timeline',
    category: 'Integration Flows',
    description: 'Node-level timeline for a specific run or the latest run of a flow.',
    componentName: 'FlowRunTimelineWidget',
    configSchema: {
      type: 'object',
      properties: {
        flowId: { type: 'string', format: 'uuid' },
        runId: { type: 'string', format: 'uuid' },
      },
      additionalProperties: false,
    },
  },
  {
    widgetKey: 'FLOW_STATUS_SUMMARY_CARD',
    displayName: 'Flow status summary',
    category: 'Integration Flows',
    description: 'Compact summary for one integration flow definition.',
    componentName: 'FlowStatusSummaryWidget',
    configSchema: {
      type: 'object',
      properties: {
        flowId: { type: 'string', format: 'uuid' },
      },
      required: ['flowId'],
      additionalProperties: false,
    },
  },
]);

const ALLOWED_COMPONENT_NAMES = new Set(DEFAULT_WIDGETS.map((w) => w.componentName));

module.exports = { DEFAULT_WIDGETS, ALLOWED_COMPONENT_NAMES };
