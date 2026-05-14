'use strict';

const { writeIncidentOpenTool } = require('./incident-open.tool');
const { writeRecommendationsScoreBatchTool } = require('./recommendations-score-batch.tool');
const { writeNotifyDispatchTool } = require('./notify-dispatch.tool');

function buildWriteTools() {
  return [writeIncidentOpenTool, writeRecommendationsScoreBatchTool, writeNotifyDispatchTool];
}

module.exports = { buildWriteTools };
