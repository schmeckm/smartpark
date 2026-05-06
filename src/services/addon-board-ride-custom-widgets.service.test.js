'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const modelsCore = require('../models');
const wsSrc = require('./addon-board-widget-source.service');
const {
  widgetIdFromSignalKey,
  buildNormalizedWidgetFromDraft,
  readCustomWidgetsFromMasterProfile,
  deriveCustomWidgetHealth,
} = require('./addon-board-ride-custom-widgets.service');

const RIDE = '11111111-1111-1111-1111-111111111111';
const PARK = '22222222-2222-2222-2222-222222222222';

test('deriveCustomWidgetHealth follows Phase M rules', () => {
  assert.equal(deriveCustomWidgetHealth({ enabled: false }), 'disabled');
  assert.equal(
    deriveCustomWidgetHealth({
      enabled: true,
      sourceEntityMismatch: true,
      resolved: { valid: false },
      latestValue: null,
    }),
    'entity_mismatch'
  );
  assert.equal(
    deriveCustomWidgetHealth({ enabled: true, resolved: { valid: false }, latestValue: null }),
    'invalid_source'
  );
  assert.equal(
    deriveCustomWidgetHealth({ enabled: true, resolved: { valid: true }, latestValue: null }),
    'no_live_value'
  );
  assert.equal(
    deriveCustomWidgetHealth({ enabled: true, resolved: { valid: true }, latestValue: { value: 1 } }),
    'ok'
  );
});

test('widgetIdFromSignalKey matches Phase J example shape', () => {
  assert.equal(widgetIdFromSignalKey('queue.wait_time_min'), 'signal_queue_wait_time_min');
});

test('buildNormalizedWidgetFromDraft matches contract', () => {
  const w = buildNormalizedWidgetFromDraft({
    sourceType: 'SIGNAL_METADATA',
    entityType: 'park_asset',
    entityId: RIDE,
    signalKey: 'queue.wait_time_min',
  });
  assert.equal(w.widgetId, 'signal_queue_wait_time_min');
  assert.equal(w.title, 'queue.wait_time_min');
  assert.equal(w.source.signalKey, 'queue.wait_time_min');
  assert.equal(w.display.type, 'latest_value');
  assert.equal(w.display.unitMode, 'fromSource');
  assert.equal(w.display.refreshMode, 'manual_or_existing_board_refresh');
  assert.equal(w.enabled, true);
});

test('readCustomWidgetsFromMasterProfile tolerates junk rows', () => {
  const list = readCustomWidgetsFromMasterProfile({
    addonBoardCustomWidgets: [
      { widgetId: 'signal_q', title: 'queue.x', source: { sourceType: 'SIGNAL_METADATA', entityType: 'park_asset', entityId: RIDE, signalKey: 'queue.x' }, display: { type: 'latest_value', unitMode: 'fromSource', refreshMode: 'manual_or_existing_board_refresh' }, enabled: true },
      'broken',
    ],
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].widgetId, 'signal_q');
});

test('promoteWidgetFromSourceDraft persists and replaces same widgetId', async () => {
  const masterProfile = {
    addonBoardWidgetSourceDraft: {
      sourceType: 'SIGNAL_METADATA',
      entityType: 'park_asset',
      entityId: RIDE,
      signalKey: 'queue.wait_time_min',
    },
    unsAssetExtensions: {
      schemaVersion: 1,
      domains: ['queue'],
      signals: {
        'queue.wait_time_min': { enabled: true, boardEligible: true, mlEligible: false },
      },
      capabilities: {},
    },
    addonBoardCustomWidgets: [
      {
        widgetId: 'signal_queue_wait_time_min',
        title: 'old',
        source: { sourceType: 'SIGNAL_METADATA', entityType: 'park_asset', entityId: RIDE, signalKey: 'queue.wait_time_min' },
        display: { type: 'latest_value', unitMode: 'fromSource', refreshMode: 'manual_or_existing_board_refresh' },
        enabled: false,
      },
    ],
  };
  let saved = null;
  const { promoteWidgetFromSourceDraft } = proxyquire('./addon-board-ride-custom-widgets.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => ({
          assetId: RIDE,
          parkId: PARK,
          masterProfile,
          getDataValue(k) {
            return this[k];
          },
          update: async (patch) => {
            saved = patch.masterProfile;
          },
        }),
      },
    },
  });
  const w = await promoteWidgetFromSourceDraft(PARK, RIDE);
  assert.equal(w.title, 'queue.wait_time_min');
  assert.equal(w.enabled, true);
  assert.ok(saved);
  const arr = /** @type {unknown[]} */ (saved.addonBoardCustomWidgets);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].title, 'queue.wait_time_min');
});

test('promoteWidgetFromSourceDraft throws DRAFT_MISSING', async () => {
  const { promoteWidgetFromSourceDraft } = proxyquire('./addon-board-ride-custom-widgets.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => ({
          assetId: RIDE,
          parkId: PARK,
          masterProfile: {},
          getDataValue(k) {
            return this[k];
          },
          update: async () => {},
        }),
      },
    },
  });
  await assert.rejects(() => promoteWidgetFromSourceDraft(PARK, RIDE), (e) => /** @type {any} */ (e).code === 'DRAFT_MISSING');
});

test('promoteWidgetFromSourceDraft throws DRAFT_NOT_VALID', async () => {
  const { promoteWidgetFromSourceDraft } = proxyquire('./addon-board-ride-custom-widgets.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => ({
          assetId: RIDE,
          parkId: PARK,
          masterProfile: {
            addonBoardWidgetSourceDraft: {
              sourceType: 'SIGNAL_METADATA',
              entityType: 'park_asset',
              entityId: RIDE,
              signalKey: 'queue.wait_time_min',
            },
            unsAssetExtensions: {
              schemaVersion: 1,
              domains: [],
              signals: { 'queue.wait_time_min': { enabled: false, boardEligible: true, mlEligible: false } },
              capabilities: {},
            },
          },
          getDataValue(k) {
            return this[k];
          },
          update: async () => {},
        }),
      },
    },
  });
  await assert.rejects(() => promoteWidgetFromSourceDraft(PARK, RIDE), (e) => /** @type {any} */ (e).code === 'DRAFT_NOT_VALID');
});

test('promoteWidgetFromSourceDraft throws DRAFT_ENTITY_MISMATCH', async () => {
  const otherRide = '33333333-3333-3333-3333-333333333333';
  const { promoteWidgetFromSourceDraft } = proxyquire('./addon-board-ride-custom-widgets.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => ({
          assetId: RIDE,
          parkId: PARK,
          masterProfile: {
            addonBoardWidgetSourceDraft: {
              sourceType: 'SIGNAL_METADATA',
              entityType: 'park_asset',
              entityId: otherRide,
              signalKey: 'queue.wait_time_min',
            },
            unsAssetExtensions: {
              schemaVersion: 1,
              domains: ['queue'],
              signals: {
                'queue.wait_time_min': { enabled: true, boardEligible: true, mlEligible: false },
              },
              capabilities: {},
            },
          },
          getDataValue(k) {
            return this[k];
          },
          update: async () => {},
        }),
      },
    },
  });
  await assert.rejects(
    () => promoteWidgetFromSourceDraft(PARK, RIDE),
    (e) => /** @type {any} */ (e).code === 'DRAFT_ENTITY_MISMATCH'
  );
});

test('getCustomWidgetsForRide enriches enabled SIGNAL_METADATA latest_value widgets', async () => {
  const masterProfile = {
    addonBoardCustomWidgets: [
      {
        widgetId: 'signal_queue_wait_time_min',
        title: 'queue.wait_time_min',
        source: {
          sourceType: 'SIGNAL_METADATA',
          entityType: 'park_asset',
          entityId: RIDE,
          signalKey: 'queue.wait_time_min',
        },
        display: {
          type: 'latest_value',
          unitMode: 'fromSource',
          refreshMode: 'manual_or_existing_board_refresh',
        },
        enabled: true,
      },
    ],
    unsAssetExtensions: {
      schemaVersion: 1,
      domains: ['queue'],
      signals: { 'queue.wait_time_min': { enabled: true, boardEligible: true, mlEligible: false } },
      capabilities: {},
    },
  };
  let previewCalls = 0;
  const { getCustomWidgetsForRide } = proxyquire('./addon-board-ride-custom-widgets.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => ({
          assetId: RIDE,
          parkId: PARK,
          masterProfile,
          slug: 'coaster',
          externalEntityId: 'e1',
          park: { slug: 'p', name: 'P', id: PARK },
          getDataValue(k) {
            return this[k];
          },
        }),
      },
    },
    './addon-board-widget-source.service': {
      readDraftFromMasterProfile: wsSrc.readDraftFromMasterProfile,
      resolveDraftPreviewForAsset: wsSrc.resolveDraftPreviewForAsset,
    },
    './signal-preview.service': {
      resolveSignalPreview: async () => {
        previewCalls += 1;
        return {
          legacy: {
            resolved: {
              valid: true,
              domain: 'queue',
              metric: 'wait_time_min',
              enabled: true,
              boardEligible: true,
            },
          },
          latestValue: {
            value: 9,
            unit: 'min',
            ts: '2026-05-06T12:00:00.000Z',
            quality: 'GOOD',
            source: 'ride_feature_snapshot',
          },
          signalKey: 'queue.wait_time_min',
          domain: 'queue',
          metric: 'wait_time_min',
          eligibility: { enabled: true, boardEligible: true, mlEligible: false },
          status: 'valid',
          entityType: 'park_asset',
          entityId: RIDE,
        };
      },
      serializeSignalPreview: (p) => {
        const { legacy: _l, ...rest } = p;
        return rest;
      },
    },
  });
  const rows = await getCustomWidgetsForRide(PARK, RIDE);
  assert.equal(previewCalls, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].latestValue?.value, 9);
  assert.equal(rows[0].resolved?.valid, true);
  assert.equal(rows[0].health, 'ok');
});

test('getCustomWidgetsForRide does not call preview for disabled widgets', async () => {
  let previewCalls = 0;
  const { getCustomWidgetsForRide } = proxyquire('./addon-board-ride-custom-widgets.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => ({
          assetId: RIDE,
          parkId: PARK,
          masterProfile: {
            addonBoardCustomWidgets: [
              {
                widgetId: 'signal_q',
                title: 'queue.x',
                source: {
                  sourceType: 'SIGNAL_METADATA',
                  entityType: 'park_asset',
                  entityId: RIDE,
                  signalKey: 'queue.x',
                },
                display: {
                  type: 'latest_value',
                  unitMode: 'fromSource',
                  refreshMode: 'manual_or_existing_board_refresh',
                },
                enabled: false,
              },
            ],
          },
          slug: 'c',
          externalEntityId: null,
          park: { slug: 'p', name: 'P', id: PARK },
          getDataValue(k) {
            return this[k];
          },
        }),
      },
    },
    './addon-board-widget-source.service': {
      readDraftFromMasterProfile: wsSrc.readDraftFromMasterProfile,
      resolveDraftPreviewForAsset: wsSrc.resolveDraftPreviewForAsset,
    },
  });
  const rows = await getCustomWidgetsForRide(PARK, RIDE);
  assert.equal(previewCalls, 0);
  assert.equal(rows[0].resolved, null);
  assert.equal(rows[0].latestValue, null);
  assert.equal(rows[0].health, 'disabled');
});

test('getCustomWidgetsForRide sets sourceEntityMismatch without live lookup', async () => {
  let previewCalls = 0;
  const other = '33333333-3333-3333-3333-333333333333';
  const { getCustomWidgetsForRide } = proxyquire('./addon-board-ride-custom-widgets.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => ({
          assetId: RIDE,
          parkId: PARK,
          masterProfile: {
            addonBoardCustomWidgets: [
              {
                widgetId: 'signal_queue_x',
                title: 'queue.x',
                source: {
                  sourceType: 'SIGNAL_METADATA',
                  entityType: 'park_asset',
                  entityId: other,
                  signalKey: 'queue.x',
                },
                display: {
                  type: 'latest_value',
                  unitMode: 'fromSource',
                  refreshMode: 'manual_or_existing_board_refresh',
                },
                enabled: true,
              },
            ],
          },
          slug: 'c',
          externalEntityId: null,
          park: { slug: 'p', name: 'P', id: PARK },
          getDataValue(k) {
            return this[k];
          },
        }),
      },
    },
    './addon-board-widget-source.service': {
      readDraftFromMasterProfile: wsSrc.readDraftFromMasterProfile,
      resolveDraftPreviewForAsset: wsSrc.resolveDraftPreviewForAsset,
    },
    './signal-preview.service': {
      resolveSignalPreview: async (args) => {
        previewCalls += 1;
        assert.equal(args.options.sourceEntityMismatch, true);
        assert.equal(args.options.skipLatestValue, true);
        return {
          legacy: {
            resolved: {
              valid: false,
              domain: 'queue',
              metric: 'x',
              enabled: false,
              boardEligible: false,
            },
          },
          latestValue: null,
          signalKey: 'queue.x',
          domain: 'queue',
          metric: 'x',
          eligibility: { enabled: false, boardEligible: false, mlEligible: false },
          status: 'entity_mismatch',
          entityType: args.entityType,
          entityId: args.entityId,
        };
      },
      serializeSignalPreview: (p) => {
        const { legacy: _l, ...rest } = p;
        return rest;
      },
    },
  });
  const rows = await getCustomWidgetsForRide(PARK, RIDE);
  assert.equal(previewCalls, 1);
  assert.equal(rows[0].sourceEntityMismatch, true);
  assert.equal(rows[0].resolved?.valid, false);
  assert.equal(rows[0].latestValue, null);
  assert.equal(rows[0].health, 'entity_mismatch');
});

test('patchCustomWidgetForRide updates title and enabled', async () => {
  const masterProfile = {
    addonBoardCustomWidgets: [
      {
        widgetId: 'signal_q',
        title: 'old',
        source: { sourceType: 'SIGNAL_METADATA', entityType: 'park_asset', entityId: RIDE, signalKey: 'queue.x' },
        display: {
          type: 'latest_value',
          unitMode: 'fromSource',
          refreshMode: 'manual_or_existing_board_refresh',
        },
        enabled: true,
      },
    ],
    unsAssetExtensions: {
      schemaVersion: 1,
      domains: [],
      signals: { 'queue.x': { enabled: true, boardEligible: true, mlEligible: false } },
      capabilities: {},
    },
  };
  const assetRow = {
    assetId: RIDE,
    parkId: PARK,
    masterProfile: JSON.parse(JSON.stringify(masterProfile)),
    slug: 's',
    externalEntityId: null,
    park: { slug: 'p', name: 'P', id: PARK },
    getDataValue(k) {
      return this[k];
    },
    async update({ masterProfile: mp }) {
      this.masterProfile = mp;
    },
    async reload() {
      /* state already updated on row */
    },
  };
  const { patchCustomWidgetForRide } = proxyquire('./addon-board-ride-custom-widgets.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => assetRow,
      },
    },
    './addon-board-widget-source.service': {
      readDraftFromMasterProfile: wsSrc.readDraftFromMasterProfile,
      resolveDraftPreviewForAsset: wsSrc.resolveDraftPreviewForAsset,
    },
    './signal-preview.service': {
      resolveSignalPreview: async () => ({
        legacy: {
          resolved: { valid: true, domain: 'queue', metric: 'x', enabled: true, boardEligible: true },
        },
        latestValue: null,
        signalKey: 'queue.x',
        domain: 'queue',
        metric: 'x',
        eligibility: { enabled: true, boardEligible: true, mlEligible: false },
        status: 'no_live_value',
        entityType: 'park_asset',
        entityId: RIDE,
      }),
      serializeSignalPreview: (p) => {
        const { legacy: _l, ...rest } = p;
        return rest;
      },
    },
  });
  const out = await patchCustomWidgetForRide(PARK, RIDE, 'signal_q', { title: 'Queue wait time', enabled: false });
  assert.equal(out.title, 'Queue wait time');
  assert.equal(out.enabled, false);
  assert.equal(out.health, 'disabled');
  assert.equal(assetRow.masterProfile.addonBoardCustomWidgets[0].title, 'Queue wait time');
  assert.equal(assetRow.masterProfile.addonBoardCustomWidgets[0].enabled, false);
});

test('patchCustomWidgetForRide throws CUSTOM_WIDGET_NOT_FOUND', async () => {
  const { patchCustomWidgetForRide } = proxyquire('./addon-board-ride-custom-widgets.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => ({
          assetId: RIDE,
          parkId: PARK,
          masterProfile: { addonBoardCustomWidgets: [] },
          getDataValue(k) {
            return this[k];
          },
          update: async () => {},
          reload: async () => {},
        }),
      },
    },
    './addon-board-widget-source.service': wsSrc,
  });
  await assert.rejects(
    () => patchCustomWidgetForRide(PARK, RIDE, 'nope', { enabled: true }),
    (e) => /** @type {any} */ (e).code === 'CUSTOM_WIDGET_NOT_FOUND'
  );
});

test('deleteCustomWidgetForRide removes widget row', async () => {
  const masterProfile = {
    addonBoardCustomWidgets: [
      {
        widgetId: 'signal_q',
        title: 't',
        source: { sourceType: 'SIGNAL_METADATA', entityType: 'park_asset', entityId: RIDE, signalKey: 'queue.x' },
        display: {
          type: 'latest_value',
          unitMode: 'fromSource',
          refreshMode: 'manual_or_existing_board_refresh',
        },
        enabled: true,
      },
    ],
  };
  const row = {
    masterProfile: JSON.parse(JSON.stringify(masterProfile)),
    getDataValue(k) {
      return this[k];
    },
    async update({ masterProfile: mp }) {
      this.masterProfile = mp;
    },
  };
  const { deleteCustomWidgetForRide } = proxyquire('./addon-board-ride-custom-widgets.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => row,
      },
    },
  });
  await deleteCustomWidgetForRide(PARK, RIDE, 'signal_q');
  assert.equal(row.masterProfile.addonBoardCustomWidgets.length, 0);
});
