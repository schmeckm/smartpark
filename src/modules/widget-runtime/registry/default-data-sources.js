'use strict';

/** Logical data sources — endpoint is internal resolver key, not an external URL. */
const DEFAULT_DATA_SOURCES = Object.freeze([
  {
    dataSourceKey: 'integration_flows.health_summary',
    displayName: 'Integration flows health summary',
    category: 'Integration Flows',
    description: 'Aggregate counts for flow definitions and recent failed runs.',
    sourceType: 'internal_api',
    endpoint: 'integration_flows.health_summary',
    refreshSeconds: 60,
  },
  {
    dataSourceKey: 'integration_flows.failed_runs',
    displayName: 'Integration flows failed runs',
    category: 'Integration Flows',
    description: 'Failed run inbox slice (reuses integration flow failure inbox).',
    sourceType: 'internal_api',
    endpoint: 'integration_flows.failed_runs',
    refreshSeconds: 60,
  },
  {
    dataSourceKey: 'integration_flows.latest_run',
    displayName: 'Integration flows latest run',
    category: 'Integration Flows',
    description: 'Most recent run for a flow (widget_config.flowId).',
    sourceType: 'internal_api',
    endpoint: 'integration_flows.latest_run',
    refreshSeconds: 30,
  },
  {
    dataSourceKey: 'integration_flows.run_timeline',
    displayName: 'Integration flows run timeline',
    category: 'Integration Flows',
    description: 'Timeline for a run (widget_config.runId or latest run of flowId).',
    sourceType: 'internal_api',
    endpoint: 'integration_flows.run_timeline',
    refreshSeconds: 30,
  },
]);

module.exports = { DEFAULT_DATA_SOURCES };
