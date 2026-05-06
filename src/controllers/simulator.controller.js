const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const sim = require('../services/simulator.service');

const start = asyncHandler(async (req, res) => {
  const data = sim.start();
  res.json({ success: true, data });
});

const stop = asyncHandler(async (req, res) => {
  res.json({ success: true, data: sim.stop() });
});

const scenario = asyncHandler(async (req, res) => {
  const { name } = req.validated;
  if (!name || !sim.SCENARIOS[name]) {
    throw new AppError('Unknown scenario', 400, { code: 'UNKNOWN_SCENARIO' });
  }
  const out = await sim.runScenario(name);
  res.json({ success: true, data: { scenario: name, result: out } });
});

const status = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { running: sim.isRunning(), scenarios: Object.keys(sim.SCENARIOS) } });
});

module.exports = { start, stop, scenario, status };
