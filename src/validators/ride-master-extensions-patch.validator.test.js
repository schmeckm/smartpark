'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { validateExtensionsPatchBody } = require('./ride-master-extensions-patch.validator');
const { errorHandler } = require('../middleware/error.middleware');

test('validateExtensionsPatchBody rejects unknown domain in domains array', async () => {
  const app = express();
  app.use(express.json());
  app.post('/t', validateExtensionsPatchBody, (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const res = await request(app).post('/t').send({ domains: ['invalid_domain'] });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_EXTENSIONS_PATCH');
});

test('validateExtensionsPatchBody rejects signal key with unsupported domain prefix', async () => {
  const app = express();
  app.use(express.json());
  app.post('/t', validateExtensionsPatchBody, (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const res = await request(app).post('/t').send({
    signals: { 'entities.queue_time': { enabled: true } },
  });
  assert.equal(res.status, 400);
});

test('validateExtensionsPatchBody rejects replaceSignals true without signals', async () => {
  const app = express();
  app.use(express.json());
  app.post('/t', validateExtensionsPatchBody, (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const res = await request(app).post('/t').send({ replaceSignals: true, domains: ['queue'] });
  assert.equal(res.status, 400);
});

test('validateExtensionsPatchBody accepts valid patch', async () => {
  const app = express();
  app.use(express.json());
  app.post('/t', validateExtensionsPatchBody, (req, res) => res.json({ validated: req.validated }));
  app.use(errorHandler);
  const res = await request(app).post('/t').send({
    domains: ['queue', 'operations'],
    replaceSignals: true,
    signals: { 'queue.wait_time_min': { enabled: true, mlEligible: false, boardEligible: true } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.validated.domains.length, 2);
});
