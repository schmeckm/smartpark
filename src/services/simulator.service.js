const { ZoneRepository } = require('../repositories/zone.repository');
const { RideRepository } = require('../repositories/ride.repository');
const { CrowdEventService } = require('./crowd-event.service');
const { IngestionService } = require('./ingestion.service');
const { emitSimulatorTick } = require('../sockets');

const Z_ALPINE = 'b1000001-0000-4000-8000-000000000002';
const Z_MED = 'b1000001-0000-4000-8000-000000000003';
const Z_PLAZA = 'b1000001-0000-4000-8000-000000000001';
const R_LAGOON = 'c2000001-0000-4000-8000-000000000005';
const R_SILVER = 'c2000001-0000-4000-8000-000000000001';

const sim = { running: false, timer: null, lastScenario: null, lastContext: {}, defaultContext: {}, tick: 0 };

const crowdEventService = new CrowdEventService();
const ingestion = new IngestionService();
const zoneRepository = new ZoneRepository();
const rideRepository = new RideRepository();

const SCENARIOS = {
  CROWD_SPIKE_ALPINE: async () => {
    const z = await zoneRepository.findById(Z_ALPINE);
    if (!z) throw new Error('Alpine zone not found in DB (run seeds)');
    const newLevel = Math.min(z.maxCapacity, Math.max(z.currentCrowdLevel + 2000, Math.floor(z.maxCapacity * 0.85)));
    return crowdEventService.createEvent({
      zoneId: Z_ALPINE,
      eventType: 'CROWD_SPIKE',
      crowdLevel: newLevel,
      severity: 4,
      source: 'simulator',
      syncZone: true,
    });
  },
  RIDE_CLOSURE_HIGH_IMPACT: async () => {
    const ride = await rideRepository.findById(R_LAGOON);
    if (!ride) throw new Error('Target ride not found (run seeds)');
    await rideRepository.updateById(R_LAGOON, { status: 'MAINTENANCE', waitTime: 0 });
    const r = await rideRepository.findById(R_LAGOON, { includeZone: true });
    if (r?.zoneId) {
      const { emitZoneUpdated } = require('../sockets');
      const zone = await zoneRepository.findById(r.zoneId, { includeRides: true, includeStaff: true });
      if (zone) emitZoneUpdated(zone);
    }
    return { rideId: R_LAGOON, status: 'MAINTENANCE' };
  },
  RAIN_SHIFT_TO_INDOOR: async (ctx = {}) =>
    ingestion.ingestWeatherObservationFromApi({
      condition: 'RAIN',
      temperatureC: 12,
      rainMm: 4.2,
      windKmh: 22,
      source: 'simulator',
      parkId: ctx.parkId || 'default',
      internalParkId: ctx.parkId || null,
      observedAt: new Date().toISOString(),
    }),
  FOOD_RUSH_LUNCH: async () => {
    const z = await zoneRepository.findById(Z_MED);
    if (!z) throw new Error('Zone not found (run seeds)');
    const newLevel = Math.min(z.maxCapacity, Math.floor(z.maxCapacity * 0.7));
    return crowdEventService.createEvent({
      zoneId: Z_MED,
      eventType: 'CROWD_SPIKE',
      crowdLevel: newLevel,
      severity: 2,
      source: 'simulator',
      syncZone: true,
    });
  },
  PARADE_END_CROWD_SHIFT: async () => {
    const z = await zoneRepository.findById(Z_PLAZA);
    if (!z) throw new Error('Plaza not found (run seeds)');
    const newLevel = Math.max(0, z.currentCrowdLevel - 800);
    return crowdEventService.createEvent({
      zoneId: Z_PLAZA,
      eventType: 'CROWD_DROP',
      crowdLevel: newLevel,
      severity: 1,
      source: 'simulator',
      syncZone: true,
    });
  },
  SILVER_COMET_LINE: async () => {
    return rideRepository.updateById(R_SILVER, { waitTime: 95, status: 'OPEN' }).then(() => {
      return ingestion.processRidePayload({
        topic: 'simulator',
        sourceSystem: 'simulator',
        payload: {
          rideId: R_SILVER,
          status: 'OPEN',
          waitTime: 95,
          source: 'simulator',
          timestamp: new Date().toISOString(),
        },
      });
    });
  },
};

function runTick() {
  if (!sim.running) return;
  const keys = Object.keys(SCENARIOS);
  const name = sim.lastScenario && keys.includes(sim.lastScenario) ? sim.lastScenario : keys[sim.tick % keys.length];
  sim.tick += 1;
  const fn = SCENARIOS[name];
  const ctx = sim.lastScenario === name ? sim.lastContext || {} : sim.defaultContext || {};
  if (fn) {
    fn(ctx)
      .then((result) => {
        emitSimulatorTick({ scenario: name, ok: true, result, at: new Date().toISOString() });
      })
      .catch((err) => {
        emitSimulatorTick({ scenario: name, ok: false, error: err.message, at: new Date().toISOString() });
      });
  }
}

function start(options = {}) {
  if (sim.running) {
    return { alreadyRunning: true, running: true };
  }
  sim.defaultContext = {
    parkId: options.parkId ? String(options.parkId) : null,
  };
  sim.running = true;
  sim.timer = setInterval(runTick, 12000);
  return { running: true, tickMs: 12000, scenarios: Object.keys(SCENARIOS), context: sim.defaultContext };
}

function stop() {
  if (sim.timer) {
    clearInterval(sim.timer);
    sim.timer = null;
  }
  sim.running = false;
  return { running: false };
}

async function runScenario(name, context = {}) {
  if (!name || !SCENARIOS[name]) {
    const e = new Error('Unknown scenario');
    e.statusCode = 400;
    throw e;
  }
  sim.lastScenario = name;
  sim.lastContext = {
    parkId: context.parkId ? String(context.parkId) : sim.defaultContext?.parkId || null,
  };
  return SCENARIOS[name](sim.lastContext);
}

module.exports = { start, stop, runScenario, SCENARIOS, isRunning: () => sim.running };
