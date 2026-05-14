'use strict';

/**
 * Phase 0 verification: the journey-log read path (`mode=from_log`) and the
 * batch-ingest path (`appendVisitorJourneyEvents`) both work end-to-end with
 * stubbed Sequelize models — no DB needed.
 *
 * These tests guard:
 *  - empty windows return the LOG_NO_TRANSITIONS envelope, not an error
 *  - case sequences are aggregated correctly into edges
 *  - direct repetitions of the same slug are deduplicated within a case
 *  - invalid ranges are rejected with INVALID_RANGE
 *  - pressure-snapshot failures degrade gracefully (no whole-call failure)
 *  - asset-in-park validation rejects foreign assetIds before any insert
 *  - default eventType / source / payload are applied
 *  - caseId is truncated to 160 chars
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const PARK = {
  get: (opts) => {
    if (opts?.plain) {
      return {
        id: 'park-uuid',
        slug: 'p1',
        name: 'Park 1',
        latitude: 48,
        longitude: 7,
        externalEntityId: 'ext-1',
      };
    }
    return null;
  },
};

function makeAssetRow({ assetId, slug, name, code, lat, lng }) {
  return {
    toJSON() {
      return {
        assetId,
        slug,
        name,
        latitude: lat,
        longitude: lng,
        assetType: code ? { code } : null,
      };
    },
  };
}

function makeJourneyRow({ caseId, occurredAt, asset }) {
  return {
    caseId,
    occurredAt,
    asset,
  };
}

function buildAsset(slug) {
  return {
    assetId: `${slug}-id`,
    slug,
    name: slug.toUpperCase(),
  };
}

function buildModelStubsForFromLog({ rows, assetsForLookup }) {
  return {
    VisitorJourneyEvent: {
      findAll: async () => rows,
    },
    ParkAsset: {
      findAll: async () =>
        assetsForLookup.map((a) =>
          makeAssetRow({
            assetId: a.assetId,
            slug: a.slug,
            name: a.name,
            code: 'RIDE',
            lat: 48 + Math.random() * 0.01,
            lng: 7 + Math.random() * 0.01,
          })
        ),
    },
    Park: {
      findByPk: async () => PARK,
    },
    AssetType: {},
  };
}

function buildPressureEngineStub({ throws = false, entities = [] } = {}) {
  return {
    GeoPressureEngineService: class {
      // eslint-disable-next-line class-methods-use-this
      async buildPressurePayload() {
        if (throws) throw new Error('boom');
        return { entities };
      }
    },
  };
}

function loadServiceWithStubs(modelsStub, engineStub) {
  return proxyquire('./geo-flow-simulator.service', {
    '../models': modelsStub,
    './geo-pressure-engine.service':
      engineStub || buildPressureEngineStub(),
  });
}

test('runVisitorFlowFromLog returns LOG_NO_TRANSITIONS envelope when no events', async () => {
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForFromLog({ rows: [], assetsForLookup: [] })
  );
  const svc = new GeoFlowSimulatorService();
  const out = await svc.run('park-uuid', { mode: 'from_log' });

  assert.equal(out.mode, 'from_log');
  assert.equal(out.meta.code, 'LOG_NO_TRANSITIONS');
  assert.equal(out.meta.eventsInWindow, 0);
  assert.equal(out.meta.casesInWindow, 0);
  assert.equal(out.meta.casesWithPath, 0);
  assert.deepEqual(out.edges, []);
  assert.deepEqual(out.ticks, []);
});

test('runVisitorFlowFromLog rejects invalid time range with INVALID_RANGE', async () => {
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForFromLog({ rows: [], assetsForLookup: [] })
  );
  const svc = new GeoFlowSimulatorService();
  const out = await svc.run('park-uuid', {
    mode: 'from_log',
    from: '2026-05-08T10:00:00Z',
    to: '2026-05-08T08:00:00Z',
  });
  assert.equal(out.error, 'INVALID_RANGE');
});

test('runVisitorFlowFromLog aggregates two events of one case into one edge', async () => {
  const a = buildAsset('alpha');
  const b = buildAsset('beta');
  const rows = [
    makeJourneyRow({
      caseId: 'c1',
      occurredAt: new Date('2026-05-08T10:00:00Z'),
      asset: a,
    }),
    makeJourneyRow({
      caseId: 'c1',
      occurredAt: new Date('2026-05-08T10:10:00Z'),
      asset: b,
    }),
  ];
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForFromLog({ rows, assetsForLookup: [a, b] })
  );
  const out = await new GeoFlowSimulatorService().run('park-uuid', { mode: 'from_log' });

  assert.equal(out.mode, 'from_log');
  assert.equal(out.edges.length, 1);
  assert.equal(out.edges[0].source, 'alpha');
  assert.equal(out.edges[0].target, 'beta');
  assert.equal(out.edges[0].value, 1);
  assert.equal(out.meta.casesInWindow, 1);
  assert.equal(out.meta.casesWithPath, 1);
  assert.equal(out.meta.eventsInWindow, 2);
});

test('runVisitorFlowFromLog deduplicates repeated visits of the same slug within a case', async () => {
  const a = buildAsset('alpha');
  const b = buildAsset('beta');
  const rows = [
    makeJourneyRow({ caseId: 'c1', occurredAt: new Date('2026-05-08T10:00:00Z'), asset: a }),
    makeJourneyRow({ caseId: 'c1', occurredAt: new Date('2026-05-08T10:01:00Z'), asset: a }),
    makeJourneyRow({ caseId: 'c1', occurredAt: new Date('2026-05-08T10:05:00Z'), asset: b }),
  ];
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForFromLog({ rows, assetsForLookup: [a, b] })
  );
  const out = await new GeoFlowSimulatorService().run('park-uuid', { mode: 'from_log' });
  assert.equal(out.edges.length, 1);
  assert.equal(out.edges[0].source, 'alpha');
  assert.equal(out.edges[0].target, 'beta');
});

test('runVisitorFlowFromLog accumulates parallel cases into shared edges', async () => {
  const a = buildAsset('alpha');
  const b = buildAsset('beta');
  const c = buildAsset('gamma');
  const rows = [
    makeJourneyRow({ caseId: 'c1', occurredAt: new Date('2026-05-08T10:00:00Z'), asset: a }),
    makeJourneyRow({ caseId: 'c1', occurredAt: new Date('2026-05-08T10:05:00Z'), asset: b }),
    makeJourneyRow({ caseId: 'c2', occurredAt: new Date('2026-05-08T11:00:00Z'), asset: a }),
    makeJourneyRow({ caseId: 'c2', occurredAt: new Date('2026-05-08T11:05:00Z'), asset: b }),
    makeJourneyRow({ caseId: 'c3', occurredAt: new Date('2026-05-08T12:00:00Z'), asset: a }),
    makeJourneyRow({ caseId: 'c3', occurredAt: new Date('2026-05-08T12:05:00Z'), asset: c }),
  ];
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForFromLog({ rows, assetsForLookup: [a, b, c] })
  );
  const out = await new GeoFlowSimulatorService().run('park-uuid', { mode: 'from_log' });
  const ab = out.edges.find((e) => e.source === 'alpha' && e.target === 'beta');
  const ac = out.edges.find((e) => e.source === 'alpha' && e.target === 'gamma');
  assert.equal(ab?.value, 2);
  assert.equal(ac?.value, 1);
  assert.equal(out.meta.casesInWindow, 3);
  assert.equal(out.meta.casesWithPath, 3);
});

test('runVisitorFlowFromLog enriches node.pressureScore from live snapshot', async () => {
  const a = buildAsset('alpha');
  const b = buildAsset('beta');
  const rows = [
    makeJourneyRow({ caseId: 'c1', occurredAt: new Date('2026-05-08T10:00:00Z'), asset: a }),
    makeJourneyRow({ caseId: 'c1', occurredAt: new Date('2026-05-08T10:05:00Z'), asset: b }),
  ];
  const engineStub = buildPressureEngineStub({
    entities: [
      { slug: 'alpha', pressureScore: 42 },
      { slug: 'beta', pressureScore: 17 },
    ],
  });
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForFromLog({ rows, assetsForLookup: [a, b] }),
    engineStub
  );
  const out = await new GeoFlowSimulatorService().run('park-uuid', { mode: 'from_log' });
  const alpha = out.nodes.find((n) => n.slug === 'alpha');
  const beta = out.nodes.find((n) => n.slug === 'beta');
  assert.equal(alpha?.pressureScore, 42);
  assert.equal(beta?.pressureScore, 17);
});

test('runVisitorFlowFromLog tolerates pressure-snapshot failures (no whole-call failure)', async () => {
  const a = buildAsset('alpha');
  const b = buildAsset('beta');
  const rows = [
    makeJourneyRow({ caseId: 'c1', occurredAt: new Date('2026-05-08T10:00:00Z'), asset: a }),
    makeJourneyRow({ caseId: 'c1', occurredAt: new Date('2026-05-08T10:05:00Z'), asset: b }),
  ];
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForFromLog({ rows, assetsForLookup: [a, b] }),
    buildPressureEngineStub({ throws: true })
  );
  const out = await new GeoFlowSimulatorService().run('park-uuid', { mode: 'from_log' });
  assert.equal(out.edges.length, 1);
  for (const n of out.nodes) {
    assert.equal(n.pressureScore, 0);
  }
});

/* ------------------------------------------------------------------ */
/* appendVisitorJourneyEvents                                          */
/* ------------------------------------------------------------------ */

function buildModelStubsForAppend({ knownAssetIds, capture }) {
  return {
    VisitorJourneyEvent: {
      bulkCreate: async (rows) => {
        capture.lastBulk = rows;
        return rows;
      },
    },
    ParkAsset: {
      findAll: async ({ where: { assetId: { [Symbol.for('sequelize.OP_IN')]: ids } = {} } = {} } = {}) => {
        // Sequelize Op.in symbol differs across versions; just return all known ids.
        return knownAssetIds.map((id) => ({ assetId: id }));
        /* unused param */ // eslint-disable-line no-unused-vars
        // intentionally ignore `ids` — the service iterates and validates per-event
      },
    },
    Park: {},
    AssetType: {},
  };
}

test('appendEvents inserts 0 when events array is empty', async () => {
  const capture = {};
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForAppend({ knownAssetIds: [], capture })
  );
  const out = await new GeoFlowSimulatorService().appendEvents('park-uuid', []);
  assert.deepEqual(out, { inserted: 0 });
  assert.equal(capture.lastBulk, undefined);
});

test('appendEvents rejects events whose assetId is not in the park', async () => {
  const capture = {};
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForAppend({ knownAssetIds: ['known-1'], capture })
  );
  const out = await new GeoFlowSimulatorService().appendEvents('park-uuid', [
    { caseId: 'c', assetId: 'foreign', occurredAt: new Date() },
  ]);
  assert.equal(out.error, 'ASSET_NOT_IN_PARK');
  assert.equal(out.assetId, 'foreign');
  assert.equal(capture.lastBulk, undefined);
});

test('appendEvents applies defaults for eventType, source, payload', async () => {
  const capture = {};
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForAppend({ knownAssetIds: ['known-1'], capture })
  );
  const out = await new GeoFlowSimulatorService().appendEvents('park-uuid', [
    { caseId: 'c', assetId: 'known-1', occurredAt: new Date('2026-05-08T10:00:00Z') },
  ]);
  assert.equal(out.inserted, 1);
  assert.equal(capture.lastBulk[0].eventType, 'ARRIVAL');
  assert.equal(capture.lastBulk[0].source, 'ingest');
  assert.deepEqual(capture.lastBulk[0].payload, {});
});

test('appendEvents truncates caseId to 160 chars', async () => {
  const capture = {};
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForAppend({ knownAssetIds: ['known-1'], capture })
  );
  const longCase = 'x'.repeat(300);
  const out = await new GeoFlowSimulatorService().appendEvents('park-uuid', [
    { caseId: longCase, assetId: 'known-1', occurredAt: new Date('2026-05-08T10:00:00Z') },
  ]);
  assert.equal(out.inserted, 1);
  assert.equal(capture.lastBulk[0].caseId.length, 160);
});

test('appendEvents preserves explicit eventType, source, and payload', async () => {
  const capture = {};
  const { GeoFlowSimulatorService } = loadServiceWithStubs(
    buildModelStubsForAppend({ knownAssetIds: ['known-1'], capture })
  );
  const payload = { camId: 'cam-7', confidence: 0.84 };
  const out = await new GeoFlowSimulatorService().appendEvents('park-uuid', [
    {
      caseId: 'c',
      assetId: 'known-1',
      occurredAt: new Date('2026-05-08T10:00:00Z'),
      eventType: 'ZONE_ENTER',
      source: 'camera-agg',
      payload,
    },
  ]);
  assert.equal(out.inserted, 1);
  assert.equal(capture.lastBulk[0].eventType, 'ZONE_ENTER');
  assert.equal(capture.lastBulk[0].source, 'camera-agg');
  assert.deepEqual(capture.lastBulk[0].payload, payload);
});
