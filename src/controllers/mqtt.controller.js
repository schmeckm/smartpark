const { asyncHandler } = require('../utils/async-handler');
const { getMqttState, getMqttTopics } = require('../services/mqtt-connector.service');
const { getCapabilityGuardStatus } = require('../services/mqtt-capability-guard.service');

const status = asyncHandler(async (req, res) => {
  const s = getMqttState();
  res.json({ success: true, data: { ...s, topics: getMqttTopics() } });
});

const capabilityGuardStatus = asyncHandler(async (_req, res) => {
  const data = await getCapabilityGuardStatus();
  res.json({ success: true, data });
});

module.exports = { status, capabilityGuardStatus };
