'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

test('rejectMqttTopicProposal marks proposal rejected without touching registry', async () => {
  const eventUpdates = [];
  const discoveryEvent = {
    id: '00000000-0000-4000-8000-0000000000e1',
    get(k) {
      if (k === 'mqttInboundMessageId') return '00000000-0000-4000-8000-0000000000m1';
      if (k === 'details') return { source: 'mqtt' };
      return null;
    },
    update: async (v) => {
      eventUpdates.push(v);
    },
  };

  let proposalUpdate;
  const proposal = {
    id: '00000000-0000-4000-8000-0000000000p1',
    discoveryEvent,
    get(k) {
      if (k === 'status') return 'pending';
      if (k === 'payloadSnapshot') return { classification: 'UNKNOWN_TOPIC' };
      return null;
    },
    update: async (v) => {
      proposalUpdate = v;
    },
  };

  const svc = proxyquire('./uns-mqtt-proposal-approval.service', {
    '../models': {
      UnsTopicProposal: { findByPk: async () => proposal },
      UnsDiscoveryEvent: {},
      UnsRegistryTopic: {},
      SignalCatalog: {},
      REGISTRY_SOURCE_PREPARED_OPERATOR: 'PREPARED_OPERATOR',
    },
  });

  const out = await svc.rejectMqttTopicProposal('00000000-0000-4000-8000-0000000000p1', { reason: 'test' }, { userId: 'u1' });
  assert.equal(out.reviewStatus, 'REJECTED');
  assert.equal(proposalUpdate.status, 'rejected');
  assert.ok(proposalUpdate.payloadSnapshot.mqttRejection);
  assert.equal(proposalUpdate.payloadSnapshot.mqttRejection.reviewStatus, 'REJECTED');
  assert.ok(eventUpdates.length >= 1);
});
