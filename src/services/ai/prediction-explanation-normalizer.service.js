/**
 * MVP explainability: normalize heterogeneous forecast / ML outputs into one response shape.
 * Does not change prediction math — only presentation + safe defaults.
 * All `featureContributions` row assembly for `AiExplainabilityMvp` lives in this file; HTTP emitters
 * re-seal via `finalizeExplainabilityMvpEnvelope` (see `ai-explainability-mvp.md` audit table).
 * @see docs/architecture/ai-explainability-mvp.md
 */

const TRACKS = {
  ADR_FORECAST: 'ADR_FORECAST',
  RIDGE_RIDE_WAIT: 'RIDGE_RIDE_WAIT',
  AI_STUDIO: 'AI_STUDIO',
};

/**
 * Stable `featureContributions[].source` values for UI + clients (additive contract).
 * @readonly
 */
const CONTRIBUTION_SOURCE = {
  SNAPSHOT: 'snapshot',
  /** AppSetting `ai.forecast.factorConfigs` — applied in baseline series step (before X-layer). */
  BASELINE_INTEGRATION: 'baseline_integration',
  /** Coded heuristics from latest park/ride snapshots (ADR X-layer). */
  X_LAYER_HEURISTIC: 'x_layer_heuristic',
  /** `mergeMlEnterpriseLayer` bumps (global/park/profile). */
  ENTERPRISE_ML: 'enterprise_ml',
  /** Ridge fallback heuristics from snapshot fields. */
  BASELINE_RULE: 'baseline_rule',
  /** Active ridge model weights. */
  RIDGE_MODEL: 'ridge_model',
  /** Reserved for future AI Studio structured rows (OpenAPI `AiExplainabilityContributionSource`). */
  AI_STUDIO: 'ai_studio',
  /** Ride signal capability: explicit `use_for_ml: false` zeroed this ridge input (`capability_ml_policy`). */
  CAPABILITY_ML_POLICY: 'capability_ml_policy',
  /** Forward-compatible fallback (OpenAPI enum). */
  UNKNOWN: 'unknown',
};

const CANONICAL_SOURCES = new Set(Object.values(CONTRIBUTION_SOURCE));

/**
 * Map any `featureContributions[].source` string to a canonical OpenAPI enum value.
 * Legacy MVP labels (`x_context`, `x_layer`) are normalized; unknown strings become `unknown`.
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeContributionSource(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return CONTRIBUTION_SOURCE.UNKNOWN;
  if (s === 'x_context') return CONTRIBUTION_SOURCE.BASELINE_INTEGRATION;
  if (s === 'x_layer') return CONTRIBUTION_SOURCE.X_LAYER_HEURISTIC;
  if (CANONICAL_SOURCES.has(s)) return s;
  return CONTRIBUTION_SOURCE.UNKNOWN;
}

/**
 * In-place canonicalization for API responses (defensive — internal builders already use constants).
 * @param {Array<{ source?: string }>|null|undefined} rows
 */
function finalizeContributionSources(rows) {
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    if (r && typeof r === 'object') r.source = normalizeContributionSource(r.source);
  }
}

/**
 * Canonicalize `featureContributions[].source` on any AiExplainabilityMvp-shaped object.
 * Mutates `payload` in place when applicable; safe for null/undefined.
 * Call after every builder and at HTTP boundaries that attach explainability.
 * @param {object|null|undefined} payload
 * @returns {object|null|undefined}
 */
function finalizeExplainabilityMvpEnvelope(payload) {
  if (payload && typeof payload === 'object' && Array.isArray(payload.featureContributions)) {
    finalizeContributionSources(payload.featureContributions);
  }
  return payload;
}

function directionFromImpact(impact) {
  if (impact > 0.05) return 'INCREASE';
  if (impact < -0.05) return 'DECREASE';
  return 'NEUTRAL';
}

/**
 * Parse strings like "+5 min", "-3 min", "0 min" to a number (minutes).
 * @param {string|undefined|null} s
 * @returns {number}
 */
function parseImpactMinutesString(s) {
  if (s == null || typeof s !== 'string') return 0;
  const m = s.replace(/\s/g, '').match(/^([+-]?\d+(?:\.\d+)?)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map legacy HIGH/MEDIUM/LOW to approximate minute weights for UI bars.
 * @param {string} [impact]
 * @returns {number}
 */
function impactLabelToMinutes(impact) {
  const u = String(impact || '').toUpperCase();
  if (u === 'HIGH') return 8;
  if (u === 'MEDIUM') return 4;
  if (u === 'LOW') return 2;
  return 1;
}

/**
 * @param {object} params
 * @param {'ADR_FORECAST'} params.track
 * @param {'park'|'entity'} params.scope
 * @param {object} params.summary - enriched park/entity forecast summary (post X-layer + ML merge)
 * @param {object} [params.legacyExplanation] - legacy park explanation object (optional)
 * @param {number} params.horizonMinutes
 * @returns {object}
 */
function buildAdrForecastExplainability({ track, scope, summary, legacyExplanation, horizonMinutes }) {
  const h = Number(horizonMinutes) || 60;
  const baseline = Number(summary?.currentAvgWaitMinutes ?? legacyExplanation?.baseValue ?? 0) || 0;
  const adjusted =
    h <= 15
      ? Number(summary?.forecast15Minutes ?? legacyExplanation?.finalPrediction ?? baseline)
      : Number(summary?.forecast60Minutes ?? legacyExplanation?.finalPrediction ?? baseline);
  const prediction = Number.isFinite(adjusted) ? Math.round(adjusted * 10) / 10 : baseline;
  const baseRounded = Math.round(baseline * 10) / 10;
  const confidence = Math.min(1, Math.max(0, Number(summary?.confidence ?? legacyExplanation?.confidence ?? 0.5) || 0));

  /** @type {Array<{ feature: string, value: unknown, impact: number, direction: string, source: string, explanation: string }>} */
  const featureContributions = [];

  const trendDelta = (prediction || 0) - baseRounded;
  featureContributions.push({
    feature: 'current_avg_wait',
    value: baseRounded,
    impact: Math.round(Math.min(30, Math.max(-30, trendDelta)) * 10) / 10,
    direction: directionFromImpact(trendDelta),
    source: CONTRIBUTION_SOURCE.SNAPSHOT,
    explanation: 'Current average wait (from latest snapshots) anchors the baseline forecast.',
  });

  const factors = Array.isArray(summary?.factors) ? summary.factors : [];
  for (const f of factors.slice(0, 6)) {
    if (!f || !f.code) continue;
    const contrib = Number(f.contribution ?? f.normalized ?? 0) || 0;
    const imp = Math.round(contrib * 12 * 10) / 10;
    featureContributions.push({
      feature: String(f.code),
      value: f.value != null ? f.value : null,
      impact: imp,
      direction: directionFromImpact(imp),
      source: CONTRIBUTION_SOURCE.BASELINE_INTEGRATION,
      explanation: `Baseline integration factor (${f.scope || 'PARK'}) from forecast factor configs — applied during the snapshot trend step before X-layer heuristics.`,
    });
  }

  const topInf = Array.isArray(summary?.topInfluencingFactors) ? summary.topInfluencingFactors : [];
  for (const row of topInf.slice(0, 8)) {
    if (!row?.feature) continue;
    const mins = parseImpactMinutesString(row.impact);
    featureContributions.push({
      feature: String(row.feature),
      value: null,
      impact: Math.abs(mins) || 0.5,
      direction: directionFromImpact(mins),
      source: CONTRIBUTION_SOURCE.ENTERPRISE_ML,
      explanation: String(row.detail || row.feature || 'Enterprise ML / profile layer contribution.'),
    });
  }

  if (Array.isArray(legacyExplanation?.adjustments)) {
    for (const adj of legacyExplanation.adjustments) {
      if (!adj?.factor) continue;
      const mag = Number(adj.magnitude) || 0;
      featureContributions.push({
        feature: String(adj.factor),
        value: null,
        impact: Math.min(20, mag),
        direction: adj.direction === 'UP' ? 'INCREASE' : adj.direction === 'DOWN' ? 'DECREASE' : 'NEUTRAL',
        source: CONTRIBUTION_SOURCE.X_LAYER_HEURISTIC,
        explanation: String(adj.reason || 'Heuristic adjustment from trend and park signals.'),
      });
    }
  }

  const crowd = summary?.crowdLevelPercent;
  if (crowd != null && Number.isFinite(Number(crowd))) {
    const c = Number(crowd) / 100;
    const imp = Math.round((c - 0.5) * 10 * 10) / 10;
    if (Math.abs(imp) > 0.1) {
      featureContributions.push({
        feature: 'crowd_density',
        value: Math.round(Number(crowd) * 10) / 10,
        impact: imp,
        direction: directionFromImpact(imp),
        source: CONTRIBUTION_SOURCE.SNAPSHOT,
        explanation: 'Park crowd pressure inferred from wait spread vs recent snapshot range.',
      });
    }
  }

  const target =
    h <= 15 ? 'predicted_queue_time_next_15min' : h <= 30 ? 'predicted_queue_time_next_30min' : 'predicted_queue_time_next_60min';

  const summaryText =
    trendDelta > 3
      ? 'Wait times are expected to rise from the current average based on trend and influencing factors.'
      : trendDelta < -3
        ? 'Wait times are expected to ease slightly from the current average.'
        : 'Wait times are expected to stay close to the current average.';

  return finalizeExplainabilityMvpEnvelope({
    target,
    prediction,
    unit: 'min',
    confidence,
    baseline: baseRounded,
    adjustedPrediction: prediction,
    featureContributions,
    summary: summaryText,
    recommendation:
      prediction > 45
        ? 'Monitor dispatch efficiency and consider guest routing to lower-wait experiences.'
        : 'Continue monitoring live wait inputs and snapshot completeness.',
    modelInfo: {
      track: TRACKS.ADR_FORECAST,
      scope,
      modelId: summary?.model?.modelName || null,
      modelVersion: summary?.model?.version || null,
      algorithm: String(summary?.forecastSource || 'baseline_x_layer'),
      basis: summary?.basis || null,
    },
  });
}

/**
 * @param {object} predictResult - return value of predictRideWaitTimes
 * @returns {object}
 */
function buildRidgeRideWaitExplainability(predictResult) {
  const horizons = Array.isArray(predictResult?.predictions) ? predictResult.predictions : [];
  const p60 = horizons.find((x) => Number(x.horizonMinutes) === 60) || horizons[horizons.length - 1] || {};
  const p30 = horizons.find((x) => Number(x.horizonMinutes) === 30);
  const rawPred =
    p30?.value != null && Number.isFinite(Number(p30.value))
      ? p30.value
      : p60?.value != null && Number.isFinite(Number(p60.value))
        ? p60.value
        : 0;
  const prediction = Number.isFinite(Number(rawPred)) ? Number(rawPred) : 0;
  const baselineWait = Number(predictResult?.snapshotWaitForExplain ?? 0);
  const baseRounded = Math.round(baselineWait * 10) / 10;
  const confidence = Math.min(1, Math.max(0, Number(predictResult?.confidence ?? 0.55) || 0.55));
  const fv =
    predictResult?.featureValuesForExplain && typeof predictResult.featureValuesForExplain === 'object'
      ? predictResult.featureValuesForExplain
      : {};

  /** @type {Array<{ feature: string, value: unknown, impact: number, direction: string, source: string, explanation: string }>} */
  const featureContributions = [];
  const tops = Array.isArray(predictResult?.topFactors) ? predictResult.topFactors : [];
  for (const tf of tops) {
    if (!tf?.feature) continue;
    const mins = impactLabelToMinutes(tf.impact);
    const featKey = String(tf.feature);
    const rawVal = Object.prototype.hasOwnProperty.call(fv, featKey) ? fv[featKey] : null;
    featureContributions.push({
      feature: featKey,
      value: rawVal != null && Number.isFinite(Number(rawVal)) ? Number(rawVal) : rawVal,
      impact: mins,
      /** HIGH/MEDIUM/LOW map to bar magnitude only — not a signed wait delta. */
      direction: 'NEUTRAL',
      source:
        predictResult.predictionMode === 'BASELINE_ONLY'
          ? CONTRIBUTION_SOURCE.BASELINE_RULE
          : CONTRIBUTION_SOURCE.RIDGE_MODEL,
      explanation:
        predictResult.predictionMode === 'BASELINE_ONLY'
          ? `Heuristic driver "${tf.feature}" from snapshot features (${tf.impact || 'impact'}).`
          : `Model weight contribution for "${tf.feature}" (${tf.impact || 'impact'}).`,
    });
  }

  const delta = Math.round((prediction - baseRounded) * 10) / 10;
  const maskedList = Array.isArray(predictResult?.mlFeaturesMaskedByCapability)
    ? predictResult.mlFeaturesMaskedByCapability.map((x) => String(x)).filter(Boolean)
    : [];
  const seenFeat = new Set(featureContributions.map((c) => c.feature));
  for (const feat of maskedList) {
    if (seenFeat.has(feat)) continue;
    seenFeat.add(feat);
    featureContributions.push({
      feature: feat,
      value: 0,
      impact: 0,
      direction: 'NEUTRAL',
      source: CONTRIBUTION_SOURCE.CAPABILITY_ML_POLICY,
      explanation:
        'Ridge ML input held at 0 by ride signal capability policy (explicit use_for_ml=false for a catalog signal mapped to this feature).',
    });
  }

  if (!featureContributions.length) {
    featureContributions.push({
      feature: 'queue_time',
      value: baseRounded,
      impact: Math.max(0.5, Math.abs(delta)),
      direction: directionFromImpact(delta),
      source: CONTRIBUTION_SOURCE.SNAPSHOT,
      explanation: 'No factor breakdown available; using snapshot-derived baseline behaviour.',
    });
  }

  const target =
    p30 != null && Number.isFinite(Number(p30.value)) ? 'predicted_queue_time_next_30min' : 'predicted_queue_time_next_60min';

  return finalizeExplainabilityMvpEnvelope({
    target,
    prediction: Math.round(prediction * 10) / 10,
    unit: 'min',
    confidence,
    baseline: baseRounded,
    adjustedPrediction: Math.round(prediction * 10) / 10,
    featureContributions,
    mlCapabilityMaskedFeatures: maskedList,
    summary:
      predictResult.predictionMode === 'BASELINE_ONLY'
        ? 'Ride wait projection uses rule-based baseline from the latest feature snapshot.'
        : 'Ride wait projection blends trained ridge weights where available with baseline fallback.',
    recommendation: prediction > 50 ? 'Consider staffing or dispatch adjustments; monitor live queue signals.' : 'OK to continue monitoring.',
    modelInfo: {
      track: TRACKS.RIDGE_RIDE_WAIT,
      modelId: predictResult.modelId || null,
      modelVersion: null,
      algorithm:
        predictResult.predictionMode === 'BASELINE_ONLY'
          ? 'baseline_snapshot'
          : predictResult.predictionMode === 'HYBRID_MODEL'
            ? 'ridge_regression_hybrid'
            : 'ridge_regression',
    },
  });
}

/**
 * Placeholder until Studio returns structured SHAP-like payloads.
 * @param {object} [studioResponse]
 * @returns {object}
 */
function buildAiStudioExplainabilityPlaceholder(studioResponse) {
  const pred = studioResponse?.prediction ?? studioResponse?.predictedValue ?? null;
  return finalizeExplainabilityMvpEnvelope({
    target: 'ai_studio_prediction',
    prediction: pred != null && Number.isFinite(Number(pred)) ? Number(pred) : null,
    unit: 'unknown',
    confidence: Number(studioResponse?.confidence ?? 0.5) || 0.5,
    baseline: null,
    adjustedPrediction: pred != null && Number.isFinite(Number(pred)) ? Number(pred) : null,
    featureContributions: [],
    summary: 'AI Studio catalog prediction — structured feature contributions are not yet exposed by this MVP.',
    recommendation: 'Use Studio metrics and training logs for deeper analysis until explainability is wired end-to-end.',
    modelInfo: {
      track: TRACKS.AI_STUDIO,
      modelId: studioResponse?.modelId || studioResponse?.model_id || null,
      modelVersion: studioResponse?.version || null,
      algorithm: 'catalog_model',
    },
  });
}

module.exports = {
  TRACKS,
  CONTRIBUTION_SOURCE,
  normalizeContributionSource,
  finalizeContributionSources,
  finalizeExplainabilityMvpEnvelope,
  buildAdrForecastExplainability,
  buildRidgeRideWaitExplainability,
  buildAiStudioExplainabilityPlaceholder,
  parseImpactMinutesString,
  directionFromImpact,
  impactLabelToMinutes,
};
