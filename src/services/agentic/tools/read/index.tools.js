'use strict';

const { dashboardSummaryTool } = require('./dashboard-summary.tool');
const { forecastReadTool } = require('./forecast-read.tool');
const { incidentsListTool } = require('./incidents-list.tool');
const { externalMappingsNeedsReviewTool } = require('./external-mappings-needs-review.tool');
const { weatherSnapshotTool } = require('./weather-snapshot.tool');
const { ridesOperationalSnapshotTool } = require('./rides-operational-snapshot.tool');

function buildDefaultTools() {
  return [
    dashboardSummaryTool,
    forecastReadTool,
    incidentsListTool,
    externalMappingsNeedsReviewTool,
    weatherSnapshotTool,
    ridesOperationalSnapshotTool,
  ];
}

module.exports = { buildDefaultTools };
