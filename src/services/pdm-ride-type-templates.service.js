'use strict';

const fs = require('fs');
const path = require('path');

/** @type {unknown} */
let cached;

function loadRideTypeTemplatesDoc() {
  if (cached !== undefined) return cached;
  const p = path.join(__dirname, '../../data/pdm/ride-type-templates.json');
  cached = JSON.parse(fs.readFileSync(p, 'utf8'));
  return cached;
}

function resetRideTypeTemplatesCacheForTests() {
  cached = undefined;
}

/**
 * @param {Record<string, unknown>} assetPlain
 * @returns {string}
 */
function resolvePdmRideTypeKey(assetPlain) {
  const mp = assetPlain.masterProfile && typeof assetPlain.masterProfile === 'object' ? assetPlain.masterProfile : null;
  const pdm = mp && typeof mp.predictiveMaintenance === 'object' ? mp.predictiveMaintenance : null;
  const fromProf = pdm && pdm.rideType != null ? String(pdm.rideType).trim() : '';
  if (fromProf) return fromProf.toUpperCase();
  const code = assetPlain.assetTypeCode != null ? String(assetPlain.assetTypeCode).trim() : '';
  if (code === 'WATER_RIDE' || code === 'RIDE_WATER') return 'WATER_RIDE';
  if (code === 'SHOW' || code === 'DARK_RIDE') return 'DARK_RIDE';
  if (code === 'TRANSPORT' || code === 'TRANSPORT_RIDE') return 'TRANSPORT_RIDE';
  if (code === 'CAROUSEL' || code === 'FLAT_RIDE') return 'ROTATING_RIDE';
  return 'ROLLERCOASTER';
}

/**
 * @param {Record<string, unknown>} assetPlain
 */
function getRideTelemetryProfileForAsset(assetPlain) {
  const doc = /** @type {{ version?: number; defaults?: Record<string, unknown>; templates?: Array<Record<string, unknown>> }} */ (
    loadRideTypeTemplatesDoc()
  );
  const key = resolvePdmRideTypeKey(assetPlain);
  const templates = Array.isArray(doc.templates) ? doc.templates : [];
  const hit = templates.find((t) => String(t.rideType || '').toUpperCase() === key);
  const base = typeof doc.defaults === 'object' && doc.defaults != null ? doc.defaults : {};
  const merged = hit
    ? {
        ...base,
        ...hit,
        rideType: hit.rideType || key,
      }
    : { ...base, rideType: key };

  return {
    profileVersion: doc.version || 1,
    rideType: String(merged.rideType || key).toUpperCase(),
    displayName: merged.displayName != null ? String(merged.displayName) : key,
    expectedMetrics: Array.isArray(merged.expectedMetrics) ? merged.expectedMetrics.map(String) : [],
    healthWeightOverrides:
      merged.healthWeightOverrides && typeof merged.healthWeightOverrides === 'object' ? merged.healthWeightOverrides : {},
    recommendedThresholdHints: Array.isArray(merged.defaultRules) ? merged.defaultRules : [],
    supportedTelemetryTypes:
      Array.isArray(merged.supportedTelemetryTypes) ? merged.supportedTelemetryTypes.map(String) : ['Sparkplug.DDATA.numeric'],
  };
}

module.exports = {
  loadRideTypeTemplatesDoc,
  resolvePdmRideTypeKey,
  getRideTelemetryProfileForAsset,
  resetRideTypeTemplatesCacheForTests,
};
