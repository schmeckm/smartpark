'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TrafficProviderConfigService } = require('./traffic-provider-config.service');
const { encryptSecret, decryptSecret } = require('../utils/credentials-crypto');

const HEX_KEY = '0123456789abcdef'.repeat(4);

test('TrafficProviderConfigService: upsert encrypts API key and stores suffix', async () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = HEX_KEY;
  let captured = null;
  const Model = {
    findOne: async () => null,
    create: async (payload) => {
      captured = { ...payload };
      return {
        get: () => ({
          ...payload,
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      };
    },
  };
  const audit = { log: async () => {} };
  const svc = new TrafficProviderConfigService({ TrafficProviderConfig: Model, auditLogService: audit });
  const dto = await svc.upsertTomTom(
    {
      enabled: true,
      apiKey: 'my-super-secret-key-XYZZ',
      pollIntervalMinutes: 12,
      timeoutMs: 20000,
      baseUrl: 'https://api.tomtom.com/routing/1/calculateRoute',
    },
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  assert.ok(captured.encryptedApiKey);
  assert.equal(captured.providerKey, 'traffic_tomtom');
  assert.notEqual(captured.encryptedApiKey, 'my-super-secret-key-XYZZ');
  assert.equal(captured.apiKeySuffix, 'XYZZ');
  assert.equal(decryptSecret(captured.encryptedApiKey), 'my-super-secret-key-XYZZ');
  assert.equal(dto.maskedApiKey, '************XYZZ');
  const json = JSON.stringify(dto);
  assert.equal(json.includes('super-secret'), false);
});

test('TrafficProviderConfigService: GET DTO never includes encrypted field', async () => {
  const row = {
    get: () => ({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      providerKey: 'traffic_tomtom',
      displayName: 'TomTom Traffic',
      enabled: true,
      encryptedApiKey: 'cipherblob',
      apiKeySuffix: 'CW1',
      pollIntervalMinutes: 10,
      timeoutMs: 15000,
      baseUrl: 'https://api.tomtom.com/routing/1/calculateRoute',
      createdByUserId: null,
      updatedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };
  const svc = new TrafficProviderConfigService({
    TrafficProviderConfig: { findOne: async () => row },
    auditLogService: { log: async () => {} },
  });
  const [dto] = await svc.listMasked();
  assert.equal(Object.prototype.hasOwnProperty.call(dto, 'encryptedApiKey'), false);
  assert.equal(dto.providerKey, 'traffic_tomtom');
  assert.equal(dto.maskedApiKey, '************CW1');
});

test('TrafficProviderConfigService: enabling without key throws', async () => {
  const svc = new TrafficProviderConfigService({
    TrafficProviderConfig: { findOne: async () => null },
    auditLogService: { log: async () => {} },
  });
  await assert.rejects(() => svc.upsertTomTom({ enabled: true }, null), (e) => e.statusCode === 422);
});

test('TrafficProviderConfigService.testTomTomConnection uses mocked fetch', async () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = HEX_KEY;
  const enc = encryptSecret('k'.repeat(24));
  const Model = {
    findOne: async () => ({
      enabled: true,
      encryptedApiKey: enc,
      apiKeySuffix: 'kkkk',
      baseUrl: 'https://api.tomtom.com/routing/1/calculateRoute',
      timeoutMs: 8000,
      pollIntervalMinutes: 10,
    }),
  };
  const body = {
    routes: [{ summary: { travelTimeInSeconds: 100, trafficDelayInSeconds: 0, lengthInMeters: 1000 } }],
  };
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
  const svc = new TrafficProviderConfigService({ TrafficProviderConfig: Model, auditLogService: { log: async () => {} } });
  const out = await svc.testTomTomConnection({}, { fetchFn });
  assert.equal(out.ok, true);
  assert.equal(out.travelTimeSeconds, 100);
});
