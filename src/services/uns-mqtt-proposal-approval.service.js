'use strict';

/**
 * Phase T.1 — Approve or reject UNS topic proposals created from MQTT inbound discovery
 * (uns_discovery_events with mqtt_inbound_message_id set; not adapter-sourced inbox).
 */

const {
  UnsTopicProposal,
  UnsDiscoveryEvent,
  UnsRegistryTopic,
  SignalCatalog,
  REGISTRY_SOURCE_PREPARED_OPERATOR,
} = require('../models');
const { AppError } = require('../utils/app-error');
const { buildCanonicalUnsTopic } = require('../modules/uns/uns-topic-generator.service');
const { parseTopic } = require('../modules/uns/uns-validator.service');
const {
  mergeOperatorCapabilityForRide,
  resolveRideContext,
  prepareUnsTopicsForRide,
  prepareSparkplugMetricsForRide,
  activatePreparedUnsTopicsForRide,
  activatePreparedSparkplugMetricsForRide,
} = require('./ride-signal-capability.service');

const PENDING = 'pending';
const APPROVED = 'approved';
const REJECTED = 'rejected';

/**
 * @param {import('../models').UnsTopicProposal} proposal
 * @param {import('../models').UnsDiscoveryEvent} event
 */
function assertMqttLinkedProposal(proposal, event) {
  if (!proposal) throw new AppError('Topic proposal not found', 404, { code: 'NOT_FOUND' });
  const st = String(proposal.get('status') || '').toLowerCase();
  if (st !== PENDING) {
    throw new AppError(`Proposal is not pending (status=${proposal.get('status')})`, 409, { code: 'PROPOSAL_NOT_PENDING' });
  }
  if (!event) throw new AppError('Discovery event missing for proposal', 422, { code: 'INVALID_PROPOSAL' });
  const mqttId = event.get('mqttInboundMessageId');
  if (!mqttId) {
    throw new AppError('Proposal is not linked to MQTT inbound discovery', 422, { code: 'NOT_MQTT_PROPOSAL' });
  }
  const d = event.get('details') || {};
  if (String(d.source || '') === 'adapter') {
    throw new AppError('Use adapter discovery approve for adapter-sourced events', 422, { code: 'USE_ADAPTER_FLOW' });
  }
}

/**
 * @param {string} proposedTopic
 * @param {string} canonicalPath
 */
function assertTpunsPathMatchesCanonical(proposedTopic, canonicalPath) {
  const p = String(proposedTopic || '').trim();
  const c = String(canonicalPath || '').trim();
  if (!p.startsWith('tpuns/')) return;
  if (p !== c) {
    throw new AppError(
      `Proposed TPUNS topic does not match canonical path for selected ride and signal (expected ${c})`,
      422,
      { code: 'TOPIC_PATH_MISMATCH', details: { proposedTopic: p, canonicalPath: c } }
    );
  }
}

/**
 * @param {string} proposalId
 * @param {{
 *   rideAssetId: string,
 *   signalCatalogId: string,
 *   signalSource: string,
 *   valueType?: string,
 *   activatePrepared?: boolean,
 * }} body
 * @param {{ userId?: string|null }} actor
 */
async function approveMqttTopicProposal(proposalId, body, actor = {}) {
  const proposal = await UnsTopicProposal.findByPk(proposalId, {
    include: [{ model: UnsDiscoveryEvent, as: 'discoveryEvent', required: true }],
  });
  const event = proposal?.discoveryEvent;
  assertMqttLinkedProposal(proposal, event);

  const rideAssetId = String(body.rideAssetId || '').trim();
  const signalCatalogId = String(body.signalCatalogId || '').trim();
  const signalSource = String(body.signalSource || '').trim();
  const valueType = body.valueType != null ? String(body.valueType).trim() : undefined;
  const activatePrepared = body.activatePrepared !== false;

  const ctx = await resolveRideContext(rideAssetId);
  const catalog = await SignalCatalog.findByPk(signalCatalogId);
  if (!catalog) {
    throw new AppError('Unknown signal_catalog id', 422, { code: 'UNKNOWN_SIGNAL' });
  }

  const proposedTopic = String(proposal.get('proposedTopic') || '').trim();
  const canonicalPath = buildCanonicalUnsTopic({
    parkSlug: ctx.parkSlug,
    entityType: 'ride',
    entitySlug: ctx.assetSlug,
    metric: catalog.get('signalCode'),
  });

  assertTpunsPathMatchesCanonical(proposedTopic, canonicalPath);
  const p = String(proposedTopic || '').trim();
  if (p.startsWith('tpuns/')) {
    let parsed;
    try {
      parsed = parseTopic(p);
    } catch {
      throw new AppError('Invalid TPUNS topic on proposal', 422, { code: 'INVALID_TPUNS_TOPIC' });
    }
    if (String(parsed.domain || '').toLowerCase() !== 'ride') {
      throw new AppError('MQTT proposal approval (T.1) supports ride domain only', 422, { code: 'DOMAIN_NOT_RIDE' });
    }
  }

  await mergeOperatorCapabilityForRide(rideAssetId, {
    signalCatalogId,
    signalSource,
    valueType: valueType || 'number',
  });

  const prepTopics = await prepareUnsTopicsForRide(rideAssetId);
  let prepSpark = { created: 0, updated: 0, rideAssetId: rideAssetId };
  if (signalSource === 'MQTT_EDGE') {
    prepSpark = await prepareSparkplugMetricsForRide(rideAssetId);
  }

  let activatedUns = { activated: 0, skipped: 0, rideAssetId: rideAssetId };
  let activatedSpark = { activated: 0, skipped: 0, rideAssetId: rideAssetId };
  if (activatePrepared) {
    const uid = actor.userId || null;
    activatedUns = await activatePreparedUnsTopicsForRide(rideAssetId, uid);
    activatedSpark = await activatePreparedSparkplugMetricsForRide(rideAssetId, uid);
  }

  const topicRow = await UnsRegistryTopic.findOne({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, topicPath: canonicalPath },
    attributes: ['id', 'topicPath', 'isActive', 'isPrepared'],
  });

  const snap = { ...(proposal.get('payloadSnapshot') || {}) };
  const nowIso = new Date().toISOString();
  await proposal.update({
    status: APPROVED,
    payloadSnapshot: {
      ...snap,
      mqttApproval: {
        reviewStatus: 'APPROVED',
        approvedAt: nowIso,
        approvedByUserId: actor.userId || null,
        rideAssetId,
        signalCatalogId,
        signalSource,
        activatePrepared,
        prepareUnsTopics: prepTopics,
        prepareSparkplug: prepSpark,
        activatedUns,
        activatedSpark,
        registryTopicId: topicRow ? topicRow.id : null,
        canonicalTopicPath: canonicalPath,
      },
    },
  });

  const evDetails = { ...(event.get('details') || {}) };
  await event.update({
    details: {
      ...evDetails,
      mqttReviewStatus: 'APPROVED',
      mqttApprovedProposalId: proposal.id,
      mqttApprovedAt: nowIso,
    },
  });

  return {
    proposalId: proposal.id,
    discoveryEventId: event.id,
    rideAssetId,
    signalCatalogId,
    signalSource,
    canonicalTopicPath: canonicalPath,
    registryTopicId: topicRow ? topicRow.id : null,
    registryTopicActive: Boolean(topicRow?.get('isActive')),
    prepareUnsTopics: prepTopics,
    prepareSparkplug: prepSpark,
    activatedUns,
    activatedSpark,
  };
}

/**
 * @param {string} proposalId
 * @param {{ reason?: string|null }} body
 * @param {{ userId?: string|null }} actor
 */
async function rejectMqttTopicProposal(proposalId, body, actor = {}) {
  const proposal = await UnsTopicProposal.findByPk(proposalId, {
    include: [{ model: UnsDiscoveryEvent, as: 'discoveryEvent', required: true }],
  });
  const event = proposal?.discoveryEvent;
  assertMqttLinkedProposal(proposal, event);

  const snap = { ...(proposal.get('payloadSnapshot') || {}) };
  const nowIso = new Date().toISOString();
  await proposal.update({
    status: REJECTED,
    payloadSnapshot: {
      ...snap,
      mqttRejection: {
        reviewStatus: 'REJECTED',
        rejectedAt: nowIso,
        rejectedByUserId: actor.userId || null,
        reason: body?.reason != null ? String(body.reason).slice(0, 500) : null,
      },
    },
  });

  const evDetails = { ...(event.get('details') || {}) };
  await event.update({
    details: {
      ...evDetails,
      mqttReviewStatus: 'REJECTED',
      mqttRejectedProposalId: proposal.id,
      mqttRejectedAt: nowIso,
    },
  });

  return { proposalId: proposal.id, discoveryEventId: event.id, reviewStatus: 'REJECTED' };
}

module.exports = {
  approveMqttTopicProposal,
  rejectMqttTopicProposal,
  assertMqttLinkedProposal,
  MQTT_PROPOSAL_STATUS: { PENDING, APPROVED, REJECTED },
};
