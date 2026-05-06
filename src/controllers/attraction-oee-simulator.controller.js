const { asyncHandler } = require('../utils/async-handler');
const {
  startAttractionOeeSimulator,
  stopAttractionOeeSimulator,
  setAttractionOeeScenario,
  getAttractionOeeSimulatorStatus,
} = require('../services/attraction-oee-simulator.service');
const { AssetsRepository } = require('../modules/assets/assets.repository');

const start = asyncHandler(async (req, res) => {
  const data = await startAttractionOeeSimulator(req.body || {});
  res.status(data.ok ? 200 : 400).json({ success: Boolean(data.ok), data });
});

const stop = asyncHandler(async (_req, res) => {
  const data = await stopAttractionOeeSimulator();
  res.json({ success: true, data });
});

const scenario = asyncHandler(async (req, res) => {
  const name = req.validated?.name || req.body?.name;
  const out = setAttractionOeeScenario(name);
  res.status(out.ok ? 200 : 400).json({ success: Boolean(out.ok), data: out });
});

const status = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: getAttractionOeeSimulatorStatus() });
});

const listCandidates = asyncHandler(async (req, res) => {
  const { parkId } = req.validated || req.query;
  const models = require('../models');
  const repo = new AssetsRepository(models);
  const rows = await repo.listRideMasterRows(parkId);
  const data = rows.map((a) => {
    const plain = a.get ? a.get({ plain: true }) : a;
    const rm = plain.rideMaster || {};
    return {
      assetId: plain.assetId,
      slug: plain.slug,
      name: plain.name,
      parkId: plain.parkId,
      rideMaster: {
        capacityPph: rm.capacityPph ?? null,
        theoreticalCapacityPph: rm.theoreticalCapacityPph ?? null,
        dispatchIntervalSec: rm.dispatchIntervalSec ?? null,
        cycleTimeSec: rm.cycleTimeSec ?? null,
        plannedCycleTimeSec: rm.plannedCycleTimeSec ?? null,
        opcReferenceCycleTimeSec: rm.opcReferenceCycleTimeSec ?? null,
        maxQueueGuests: rm.maxQueueGuests ?? null,
        seatsPerCycle: rm.seatsPerCycle ?? null,
        trainsCount: rm.trainsCount ?? null,
      },
    };
  });
  res.json({ success: true, data });
});

module.exports = { start, stop, scenario, status, listCandidates };
