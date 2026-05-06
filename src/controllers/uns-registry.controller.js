'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { unsRegistryMirrorService } = require('../services/uns-registry-mirror.service');

function resolveParkId(req) {
  const q = req.query.parkId;
  if (q != null && String(q).trim() !== '') return String(q).trim();
  return req.parkContext?.id || undefined;
}

function normalizedParkId(v) {
  if (v == null || v === '') return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

const getMirrorSummary = asyncHandler(async (req, res) => {
  await unsRegistryMirrorService.syncFromLegacyIfStale();
  const data = await unsRegistryMirrorService.getSummaryCounts();
  res.json({ success: true, data });
});

const listEntities = asyncHandler(async (req, res) => {
  await unsRegistryMirrorService.syncFromLegacyIfStale();
  const v = req.validated || {};
  const data = await unsRegistryMirrorService.listEntities({
    parkId: normalizedParkId(v.parkId) || resolveParkId(req),
    entityKind: v.entityKind && String(v.entityKind).trim() !== '' ? v.entityKind : undefined,
    limit: v.limit,
    offset: v.offset,
  });
  res.json({ success: true, data });
});

const listTopics = asyncHandler(async (req, res) => {
  await unsRegistryMirrorService.syncFromLegacyIfStale();
  const v = req.validated || {};
  const data = await unsRegistryMirrorService.listTopics({
    parkId: normalizedParkId(v.parkId) || resolveParkId(req),
    limit: v.limit,
    offset: v.offset,
  });
  res.json({ success: true, data });
});

module.exports = {
  getMirrorSummary,
  listEntities,
  listTopics,
};
