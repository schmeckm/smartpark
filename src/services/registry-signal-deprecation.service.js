'use strict';

/**
 * Phase 11 — Registry signal deprecation governance (additive).
 * Does not change MQTT connector, ThemeParks sync, registry publisher logic, UNS nodes, or uns_latest_states writes.
 */

const { Op, fn, col, where } = require('sequelize');
const { AppError } = require('../utils/app-error');
const env = require('../config/env');
const {
  SignalCatalog,
  RegistrySignalDeprecation,
  RegistryPublishEvent,
  UnsRegistryTopic,
  SparkplugMetricDefinition,
  REGISTRY_SOURCE_PREPARED_OPERATOR,
} = require('../models');
const { buildCanonicalUnsTopic } = require('../modules/uns/uns-topic-generator.service');
const { evaluateRegistryPathUsable } = require('./operations-facts.service');
const {
  resolveRideContext,
  loadMergedCapabilityMap,
  capabilitySignalSource,
  preparedUnsTopicsForRide,
} = require('./ride-signal-capability.service');

function toIso(d) {
  if (!d) return null;
  try {
    const x = d instanceof Date ? d : new Date(d);
    return Number.isNaN(x.getTime()) ? null : x.toISOString();
  } catch {
    return null;
  }
}

/** @param {import('../models').RegistrySignalDeprecation | null} row */
function serializeDeprecationRow(row) {
  if (!row) {
    return {
      id: null,
      registryAuthoritative: false,
      legacyFallbackDisabled: false,
      legacyPublishDisabled: false,
      validationStartedAt: null,
      authoritativeMarkedAt: null,
      legacyFallbackDisabledAt: null,
      legacyPublishDisabledAt: null,
      lastHealthPassAt: null,
      stabilityWindowStartedAt: null,
      updatedByUserId: null,
    };
  }
  return {
    id: row.id,
    registryAuthoritative: Boolean(row.registryAuthoritative),
    legacyFallbackDisabled: Boolean(row.legacyFallbackDisabled),
    legacyPublishDisabled: Boolean(row.legacyPublishDisabled),
    validationStartedAt: toIso(row.validationStartedAt),
    authoritativeMarkedAt: toIso(row.authoritativeMarkedAt),
    legacyFallbackDisabledAt: toIso(row.legacyFallbackDisabledAt),
    legacyPublishDisabledAt: toIso(row.legacyPublishDisabledAt),
    lastHealthPassAt: toIso(row.lastHealthPassAt),
    stabilityWindowStartedAt: toIso(row.stabilityWindowStartedAt),
    updatedByUserId: row.updatedByUserId ?? null,
  };
}

function activationPathOk(signalSource, activeTopic, sparkRow) {
  if (signalSource === 'MQTT_EDGE') {
    return Boolean(sparkRow && sparkRow.get('isActive'));
  }
  return Boolean(activeTopic && activeTopic.get('isActive'));
}

async function computeDeprecationHealth(ctx, signalCode, signalSource, activeTopic, topicPath, sparkRow, depRow) {
  /** @type {{ id: string, ok: boolean, detail: string }[]} */
  const checks = [];

  const actOk = activationPathOk(signalSource, activeTopic, sparkRow);
  checks.push({
    id: 'active_registry_path',
    ok: actOk,
    detail: actOk
      ? 'Active registry UNS topic or Sparkplug metric (as required by source)'
      : 'No active registry topic/metric for this signal source',
  });

  const probe = await evaluateRegistryPathUsable(activeTopic, topicPath, ctx, signalCode);
  checks.push({
    id: 'registry_path_value',
    ok: probe.usable,
    detail: probe.detail,
  });

  const since = new Date(Date.now() - env.registrySignalPublishMaxAgeMs);
  const orConds = [];
  if (activeTopic?.id) orConds.push({ registryTopicId: activeTopic.id });
  if (sparkRow?.id) orConds.push({ sparkplugMetricDefinitionId: sparkRow.id });

  let pub = null;
  if (orConds.length) {
    pub = await RegistryPublishEvent.findOne({
      where: {
        rideAssetId: ctx.assetId,
        status: 'PUBLISHED',
        createdAt: { [Op.gte]: since },
        [Op.or]: orConds,
      },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'createdAt'],
    });
  }
  checks.push({
    id: 'recent_publish',
    ok: Boolean(pub),
    detail: pub
      ? `PUBLISHED registry event within ${env.registrySignalPublishMaxAgeMs}ms`
      : 'No qualifying PUBLISHED registry_publish_events in window',
  });

  let stabilityOk = true;
  let stabilityDetail = 'Stability window not required (REGISTRY_SIGNAL_STABILITY_DAYS=0)';
  if (env.registrySignalStabilityDays > 0) {
    const start = depRow?.stabilityWindowStartedAt ?? depRow?.get?.('stabilityWindowStartedAt');
    if (!start) {
      stabilityOk = false;
      stabilityDetail = 'stability_window_started_at not set';
    } else {
      const days = (Date.now() - new Date(start).getTime()) / 86_400_000;
      stabilityOk = days >= env.registrySignalStabilityDays;
      stabilityDetail = stabilityOk
        ? `Stability ≥ ${env.registrySignalStabilityDays}d`
        : `Need ${env.registrySignalStabilityDays}d stability; elapsed ${days.toFixed(2)}d`;
    }
  }
  checks.push({
    id: 'stability_window',
    ok: stabilityOk,
    detail: stabilityDetail,
  });

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

async function resolveCatalogForSignalKey(rawKey) {
  const k = String(rawKey || '').trim();
  if (!k) return null;
  let cat = await SignalCatalog.findOne({ where: { signalCode: k } });
  if (!cat) {
    cat = await SignalCatalog.findOne({
      where: where(fn('lower', col('signal_code')), k.toLowerCase()),
    });
  }
  return cat;
}

async function buildConfiguredSignals(rideAssetId) {
  const ctx = await resolveRideContext(rideAssetId);
  const bySignal = await loadMergedCapabilityMap(ctx);

  const preparedTopics = await UnsRegistryTopic.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR },
    limit: 600,
  });
  const topicsForAsset = preparedUnsTopicsForRide(ctx, preparedTopics);
  const topicByPath = new Map(topicsForAsset.map((t) => [t.topicPath, t]));

  const preparedSpark = await SparkplugMetricDefinition.findAll({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, rideAssetId: ctx.assetId },
    limit: 400,
  });
  const sparkBySignalKey = new Map();
  for (const s of preparedSpark) {
    const sk = s.get('signalKey') ?? s.get('metricName');
    if (sk == null || String(sk).trim() === '') continue;
    sparkBySignalKey.set(String(sk).trim(), s);
  }

  const catalogIds = [...bySignal.keys()];
  const catalogs = catalogIds.length
    ? await SignalCatalog.findAll({ where: { id: { [Op.in]: catalogIds } }, limit: 600 })
    : [];
  const catById = new Map(catalogs.map((c) => [String(c.id), c]));

  const rows = [];

  for (const catalogId of catalogIds) {
    const cap = bySignal.get(catalogId);
    const src = capabilitySignalSource(cap);
    if (src === 'NOT_AVAILABLE') continue;

    const cat = catById.get(String(catalogId));
    if (!cat) continue;
    const signalCode = cat.get('signalCode');
    if (!signalCode) continue;

    const topicPath =
      src !== 'MASTER_DATA'
        ? buildCanonicalUnsTopic({
            parkSlug: ctx.parkSlug,
            entityType: 'ride',
            entitySlug: ctx.assetSlug,
            metric: signalCode,
          })
        : null;
    const topicRow = topicPath ? topicByPath.get(topicPath) : null;
    const sparkRow = src === 'MQTT_EDGE' ? sparkBySignalKey.get(String(signalCode)) : undefined;

    rows.push({
      signalCatalogId: String(catalogId),
      signalCode: String(signalCode),
      signalSource: src,
      activeTopic: topicRow,
      topicPath,
      sparkRow: sparkRow || undefined,
    });
  }

  rows.sort((a, b) => a.signalCode.localeCompare(b.signalCode));
  return { ctx, rows };
}

async function listRegistrySignalDeprecations(rideAssetId) {
  const { ctx, rows } = await buildConfiguredSignals(rideAssetId);
  const dbRows = await RegistrySignalDeprecation.findAll({
    where: { rideAssetId: ctx.assetId },
    limit: 600,
  });
  const byKey = new Map();
  for (const r of dbRows) {
    byKey.set(String(r.signalKey), r);
  }

  const signals = [];
  for (const r of rows) {
    const dep = byKey.get(r.signalCode) || null;
    const health = await computeDeprecationHealth(
      ctx,
      r.signalCode,
      r.signalSource,
      r.activeTopic,
      r.topicPath,
      r.sparkRow,
      dep
    );
    signals.push({
      signalKey: r.signalCode,
      signalCatalogId: r.signalCatalogId,
      signalSource: r.signalSource,
      isActiveTopic: Boolean(r.activeTopic && r.activeTopic.get('isActive')),
      isActiveSparkplug: Boolean(r.sparkRow && r.sparkRow.get('isActive')),
      deprecation: serializeDeprecationRow(dep),
      health,
    });
  }

  return { rideAssetId: ctx.assetId, signals };
}

async function getRegistrySignalDeprecationHealth(rideAssetId) {
  const { rideAssetId: id, signals } = await listRegistrySignalDeprecations(rideAssetId);
  return {
    rideAssetId: id,
    evaluatedAt: new Date().toISOString(),
    signals: signals.map((s) => ({
      signalKey: s.signalKey,
      signalCatalogId: s.signalCatalogId,
      health: s.health,
    })),
  };
}

async function deprecateRegistrySignal(rideAssetId, body, userId) {
  const cat = await resolveCatalogForSignalKey(body.signalKey);
  if (!cat) {
    throw new AppError('Unknown signal_key (no signal_catalog match)', 422, { code: 'UNKNOWN_SIGNAL_KEY' });
  }
  const canonicalKey = String(cat.get('signalCode'));

  const { ctx, rows } = await buildConfiguredSignals(rideAssetId);
  const configured = rows.find((r) => r.signalCode === canonicalKey);
  if (!configured) {
    throw new AppError('Signal is not configured for this ride (NOT_AVAILABLE or missing capability)', 422, {
      code: 'SIGNAL_NOT_CONFIGURED',
    });
  }

  const [depRow] = await RegistrySignalDeprecation.findOrCreate({
    where: { rideAssetId: ctx.assetId, signalKey: canonicalKey },
    defaults: {
      rideAssetId: ctx.assetId,
      signalKey: canonicalKey,
      signalCatalogId: cat.id,
      registryAuthoritative: false,
      legacyFallbackDisabled: false,
      legacyPublishDisabled: false,
    },
  });

  if (!depRow.get('signalCatalogId')) {
    await depRow.update({ signalCatalogId: cat.id });
  }

  const now = new Date();
  const alreadyFallbackOff = Boolean(depRow.get('legacyFallbackDisabled'));
  const alreadyAuth = Boolean(depRow.get('registryAuthoritative'));

  if (body.registryAuthoritative === false && depRow.get('legacyFallbackDisabled')) {
    throw new AppError('Cannot clear registry authoritative while legacy fallback is disabled', 422, {
      code: 'DEPRECATION_CONSTRAINT',
    });
  }

  let nextAuth = alreadyAuth;
  if (body.registryAuthoritative === true) nextAuth = true;
  if (body.registryAuthoritative === false) nextAuth = false;

  let nextFallbackOff = alreadyFallbackOff;
  if (body.disableLegacyFallback === true) nextFallbackOff = true;
  if (body.disableLegacyFallback === false) nextFallbackOff = false;

  const turningFallbackOn = nextFallbackOff && !alreadyFallbackOff;
  if (turningFallbackOn) {
    if (!nextAuth && body.registryAuthoritative !== true) {
      throw new AppError('registry_authoritative required before disabling legacy fallback', 422, {
        code: 'DEPRECATION_POLICY',
      });
    }
    const health = await computeDeprecationHealth(
      ctx,
      configured.signalCode,
      configured.signalSource,
      configured.activeTopic,
      configured.topicPath,
      configured.sparkRow,
      depRow
    );
    if (!health.ok) {
      throw new AppError('Signal deprecation health checks failed; cannot disable legacy fallback', 422, {
        code: 'DEPRECATION_HEALTH_FAILED',
        details: { health },
      });
    }
  }

  const updates = {
    updatedByUserId: userId || null,
    validationStartedAt: depRow.get('validationStartedAt') || now,
  };

  if (body.registryAuthoritative === true) {
    updates.registryAuthoritative = true;
    updates.authoritativeMarkedAt = depRow.get('authoritativeMarkedAt') || now;
    updates.stabilityWindowStartedAt = depRow.get('stabilityWindowStartedAt') || now;
  }
  if (body.registryAuthoritative === false) {
    updates.registryAuthoritative = false;
    updates.authoritativeMarkedAt = null;
    updates.stabilityWindowStartedAt = null;
  }

  if (body.disableLegacyFallback === true) {
    updates.legacyFallbackDisabled = true;
    updates.legacyFallbackDisabledAt = depRow.get('legacyFallbackDisabledAt') || now;
    updates.lastHealthPassAt = now;
  }
  if (body.disableLegacyFallback === false) {
    updates.legacyFallbackDisabled = false;
    updates.legacyFallbackDisabledAt = null;
  }

  if (body.legacyPublishDisabled === true) {
    updates.legacyPublishDisabled = true;
    updates.legacyPublishDisabledAt = depRow.get('legacyPublishDisabledAt') || now;
  }
  if (body.legacyPublishDisabled === false) {
    updates.legacyPublishDisabled = false;
    updates.legacyPublishDisabledAt = null;
  }

  await depRow.update(updates);
  await depRow.reload();

  const health = await computeDeprecationHealth(
    ctx,
    configured.signalCode,
    configured.signalSource,
    configured.activeTopic,
    configured.topicPath,
    configured.sparkRow,
    depRow
  );

  return {
    rideAssetId: ctx.assetId,
    signalKey: canonicalKey,
    signalCatalogId: String(cat.id),
    deprecation: serializeDeprecationRow(depRow),
    health,
  };
}

async function reactivateRegistrySignal(rideAssetId, body, userId) {
  const cat = await resolveCatalogForSignalKey(body.signalKey);
  if (!cat) {
    throw new AppError('Unknown signal_key (no signal_catalog match)', 422, { code: 'UNKNOWN_SIGNAL_KEY' });
  }
  const canonicalKey = String(cat.get('signalCode'));

  const ctx = await resolveRideContext(rideAssetId);
  const depRow = await RegistrySignalDeprecation.findOne({
    where: { rideAssetId: ctx.assetId, signalKey: canonicalKey },
  });
  if (!depRow) {
    return {
      rideAssetId: ctx.assetId,
      signalKey: canonicalKey,
      signalCatalogId: String(cat.id),
      deprecation: serializeDeprecationRow(null),
      touched: false,
    };
  }

  await depRow.update({
    registryAuthoritative: false,
    legacyFallbackDisabled: false,
    legacyPublishDisabled: false,
    validationStartedAt: null,
    authoritativeMarkedAt: null,
    legacyFallbackDisabledAt: null,
    legacyPublishDisabledAt: null,
    lastHealthPassAt: null,
    stabilityWindowStartedAt: null,
    updatedByUserId: userId || null,
  });
  await depRow.reload();

  return {
    rideAssetId: ctx.assetId,
    signalKey: canonicalKey,
    signalCatalogId: String(cat.id),
    deprecation: serializeDeprecationRow(depRow),
    touched: true,
  };
}

module.exports = {
  listRegistrySignalDeprecations,
  getRegistrySignalDeprecationHealth,
  deprecateRegistrySignal,
  reactivateRegistrySignal,
  serializeDeprecationRow,
};
