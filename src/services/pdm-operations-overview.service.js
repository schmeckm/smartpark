'use strict';

const { Op } = require('sequelize');
const { getFlags } = require('../bootstrap/feature-flags');
const { ParkAsset, ParkAssetPdmRule, Park } = require('../models');
const { evaluatePredictiveMaintenanceForAsset } = require('./predictive-maintenance.service');

/**
 * @param {string} parkId
 * @param {{ limit?: number }} [opts]
 */
async function listParkPdmOperationsOverview(parkId, opts = {}) {
  const flags = getFlags();
  const lim = Math.min(80, Math.max(1, Number(opts.limit) || 48));

  if (!flags.pdm?.industrialPlatformEnabled) {
    return {
      industrialPlatformEnabled: false,
      operationsBoardEnabled: Boolean(flags.pdm?.operationsBoardEnabled),
      assets: [],
    };
  }

  const ruleRows = await ParkAssetPdmRule.findAll({
    where: { parkId, enabled: true },
    attributes: ['assetId'],
    raw: true,
  });
  const ids = [...new Set(ruleRows.map((r) => String(r.assetId)).filter(Boolean))].slice(0, lim);
  if (!ids.length) {
    return {
      industrialPlatformEnabled: true,
      operationsBoardEnabled: Boolean(flags.pdm?.operationsBoardEnabled),
      assets: [],
    };
  }

  const assets = await ParkAsset.findAll({
    where: { parkId, assetId: { [Op.in]: ids } },
    attributes: ['assetId', 'parkId', 'name', 'slug', 'assetTypeCode', 'masterProfile'],
  });

  const park = await Park.findByPk(parkId, { attributes: ['slug', 'name', 'id'] });
  const parkSlug = park?.slug || park?.name || String(parkId);

  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const row of assets) {
    const plain = row.get({ plain: true });
    const aid = String(plain.assetId);
    const rules = await ParkAssetPdmRule.findAll({
      where: { parkId, assetId: aid, enabled: true },
      order: [
        ['sortOrder', 'ASC'],
        ['metricName', 'ASC'],
      ],
    });
    const enabledPlain = rules.map((r) => r.get({ plain: true }));
    const evaluation = await evaluatePredictiveMaintenanceForAsset(plain, parkSlug, enabledPlain);
    if (!evaluation) continue;
    const ind = evaluation.industrial && typeof evaluation.industrial === 'object' ? evaluation.industrial : null;
    out.push({
      assetId: aid,
      name: plain.name != null ? String(plain.name) : null,
      slug: plain.slug != null ? String(plain.slug) : null,
      riskLevel: evaluation.riskLevel,
      healthScore: ind?.health?.healthScore ?? null,
      healthState: ind?.health?.healthState ?? null,
      healthTrend: ind?.health?.healthTrend ?? null,
      telemetryOverall: ind?.telemetryQuality?.overall ?? null,
      topFailureMode: Array.isArray(ind?.failureModes) && ind.failureModes[0] ? ind.failureModes[0].code : null,
      evaluatedAt: evaluation.evaluatedAt,
    });
  }

  out.sort((a, b) => {
    const ha = typeof a.healthScore === 'number' ? a.healthScore : 999;
    const hb = typeof b.healthScore === 'number' ? b.healthScore : 999;
    if (ha !== hb) return ha - hb;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return {
    industrialPlatformEnabled: true,
    operationsBoardEnabled: Boolean(flags.pdm?.operationsBoardEnabled),
    generatedAt: new Date().toISOString(),
    assets: out,
  };
}

module.exports = {
  listParkPdmOperationsOverview,
};
