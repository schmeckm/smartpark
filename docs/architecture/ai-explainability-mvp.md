# AI explainability MVP (normalization layer)

This document describes the **first safe step** toward explainable forecasting in Smart Park OS. It adds a **presentation-only normalization layer** on top of the existing, ADR 0001–aligned forecast pipeline and the ridge ride-wait predictor. It does **not** replace forecast services, change snapshot schemas, add database tables, or introduce a new model engine.

## Three AI/ML tracks

| Track | Role | Where it runs |
| --- | --- | --- |
| **ADR_FORECAST** | Baseline from 5-minute feature snapshots → X-layer heuristics → optional enterprise ML factor merge (read path). | `AiParkForecastService` (`/api/v1/ai/parks/.../forecast/*`, `/api/v1/ai/entities/.../forecast/*`) |
| **RIDGE_RIDE_WAIT** | Per-ride ridge (or global ridge) on the ride feature vector, with baseline fallback. | `ride-prediction.service` (`/api/v1/ai/ml/predict/rides/:rideId`, legacy `/ml/...`) |
| **AI_STUDIO** | Separate catalog training/predict surface for experimentation. | `/api/v1/ai/studio/*` |

Explainability for ADR and ridge is produced by **`prediction-explanation-normalizer.service.js`**, which maps heterogeneous internal objects into one **stable JSON shape** (`target`, `prediction`, `unit`, `confidence`, `baseline`, `adjustedPrediction`, `featureContributions`, `summary`, `recommendation`, `modelInfo`).

## Why a normalizer instead of changing the forecast core

- **Preserves validated behavior**: Forecast math, snapshot ingestion, and merge order stay unchanged (ADR 0001).
- **Single contract for UI and integrations**: Admin and future clients consume one explainability shape regardless of track.
- **Low risk rollout**: New fields are **additive** (`explainability` on forecast explanations; `explanation` inside ML ride predict `data`).

## How X features become Y predictions (ADR path)

Unchanged from ADR 0001:

1. **Adapters** write into the SoR and **5-minute snapshots** (`ParkFeatureSnapshot`, `RideFeatureSnapshot`).
2. On **read**, the service builds a baseline from recent snapshot series, applies **baseline integration factor configs** (`ai.forecast.factorConfigs`), then **X-layer snapshot heuristics**, then optionally **merges enterprise ML** metadata on the enriched summary.

The normalizer **reads** `currentAvgWaitMinutes`, `forecast15Minutes` / `forecast60Minutes`, `factors` (baseline integration step), `topInfluencingFactors` (enterprise ML merge), `crowdLevelPercent`, and legacy explanation `adjustments` (X-layer narrative) to populate `featureContributions` and narrative fields. It does **not** re-order or re-compute forecasts.

### Contribution `source` taxonomy (`featureContributions[].source`)

| Value | Meaning |
| --- | --- |
| `snapshot` | Anchors and context taken from latest 5m snapshot fields (e.g. current average wait, crowd spread). |
| `baseline_integration` | Rows from **`summary.factors`** — AppSetting / integration **forecast factor configs** applied during the **baseline trend** step (before coded X-layer rules). |
| `x_layer_heuristic` | Legacy **`adjustments`** list and other coded snapshot-driven heuristics attached to the explanation payload. |
| `enterprise_ml` | **`summary.topInfluencingFactors`** after `mergeMlEnterpriseLayer` (global/park/profile bumps). |
| `baseline_rule` | Ridge path: heuristic **topFactors** when no trained model applies. |
| `ridge_model` | Ridge path: **topFactors** from active ridge weights. |
| `capability_ml_policy` | Ridge path: ML input held at **0** because **`use_for_ml` explicit `false`** on a mapped ride signal capability (see `ride-ml-feature-mask.service.js`). Also listed under `mlCapabilityMaskedFeatures` on the envelope. |
| `ai_studio` | Reserved for future structured AI Studio attributions (OpenAPI enum; not emitted in `featureContributions` today). |
| `unknown` | Forward-compatible fallback if a newer server adds a source before clients/specs are updated. |

OpenAPI: `components.schemas.AiExplainabilityContributionSource` lists the same canonical enum.

### Runtime normalization (stability)

**`finalizeExplainabilityMvpEnvelope(payload)`** runs **`finalizeContributionSources`** on `payload.featureContributions` when that array exists, so every `source` is set via **`normalizeContributionSource`**:

- Legacy labels **`x_context`** → `baseline_integration`, **`x_layer`** → `x_layer_heuristic` (pre–OpenAPI naming).
- Any string in the **`CONTRIBUTION_SOURCE`** / OpenAPI enum set is passed through unchanged.
- Empty or unrecognized strings → **`unknown`**.

Each builder (`buildAdrForecastExplainability`, `buildRidgeRideWaitExplainability`, `buildAiStudioExplainabilityPlaceholder`) returns the envelope through **`finalizeExplainabilityMvpEnvelope`**. **HTTP emission paths** call it again on the builder result so the contract stays sealed even if a future refactor merges extra rows outside the builders:

| Step | File | Notes |
| --- | --- | --- |
| Row assembly | `src/services/ai/prediction-explanation-normalizer.service.js` | **Only** place `featureContributions.push(...)` exists in the repo for `AiExplainabilityMvp`. |
| Park / entity forecast explanation | `src/services/ai-park-forecast.service.js` | `getExplanation`, `getEntityExplanation` → `finalizeExplainabilityMvpEnvelope(buildAdrForecastExplainability(...))`. |
| Ridge ride predict | `src/controllers/ml-prediction.controller.js` | `getPredictRide` when `explain` is set → `finalizeExplainabilityMvpEnvelope(buildRidgeRideWaitExplainability(data))`. |

**Out of scope:** `GET /ai/recommendations/:id/explanation` returns recommendation scoring fields, not `AiExplainabilityMvp` / `featureContributions`.

Exports: `CONTRIBUTION_SOURCE`, `normalizeContributionSource`, `finalizeContributionSources`, **`finalizeExplainabilityMvpEnvelope`** in `src/services/ai/prediction-explanation-normalizer.service.js`. The admin **`RideAiExplainabilityCard`** still maps legacy keys for **cached** or **older** client-side data.

### Which sources appear by track

| `source` | ADR forecast (`explainability`) | Ridge ride wait (`data.explanation`) |
| --- | --- | --- |
| `snapshot` | Yes (anchors / fallback rows) | Yes (fallback when no `topFactors`) |
| `baseline_integration` | Yes (`summary.factors`) | No |
| `x_layer_heuristic` | Yes (legacy `adjustments`, trend/crowd heuristics) | No |
| `enterprise_ml` | Yes (`topInfluencingFactors`) | No |
| `ridge_model` | No | Yes (`topFactors`, model path) |
| `baseline_rule` | No | Yes (`topFactors`, `BASELINE_ONLY`) |
| `capability_ml_policy` | No | Yes (when `mlFeaturesMaskedByCapability` non-empty) |
| `ai_studio` | Reserved | Reserved |
| `unknown` | Possible after normalization | Possible after normalization |

## Ridge path

`predictRideWaitTimes` exposes **`snapshotWaitForExplain`** (current queue proxy from the feature map) and **`featureValuesForExplain`** (numeric snapshot features) for UI and the normalizer. **Top factors** come from either ridge weight importances or baseline heuristics (`topFactors`). Impacts are mapped to minute-scale bars for display; this is a **view model**, not a second model.

## AI Studio

`buildAiStudioExplainabilityPlaceholder` returns the same envelope with **empty** `featureContributions` until Studio exposes structured attributions. No refactor of Studio internals.

## Where learned weights can land later

- **Ridge**: Signed per-feature attributions (e.g. linear local surrogate) can replace or augment `impactLabelToMinutes` mapping while keeping the same response contract.
- **ADR**: SHAP-style or profile-linked deltas can feed `featureContributions` with `source: 'enterprise_ml'` or additional `CONTRIBUTION_SOURCE` entries without changing snapshot tables.
- **New columns**: Optional future persistence of explanation snapshots remains out of scope until product and governance agree.

## API surface (MVP)

- `GET /api/v1/ai/parks/:externalParkId/forecast/explanation` — legacy fields **plus** `explainability`.
- `GET /api/v1/ai/entities/:externalEntityId/forecast/explanation` — same for per-entity ADR path.
- `GET /api/v1/ai/ml/predict/rides/:rideId` (and deprecated `/ml/...`) — same handler with **opt-in explainability**:
  - default response: legacy prediction payload only
  - `?explain=1` or `?explain=true`: include `data.explanation`

This keeps high-frequency ML prediction payloads lean unless a UI/client explicitly needs narrative explainability.

## Admin UI usage

- `RideAiExplainabilityCard.vue` is reused in both:
  - `AiRideWaitGridView` ride detail drawer (ADR + ridge cards; ridge requests `explain=true`)
  - `AiInsightsView` compact entity explainability section (ADR card)

## Tests

`src/services/ai/prediction-explanation-normalizer.service.test.js` covers ADR shaping, ridge top-factor mapping, missing metadata safety, **`normalizeContributionSource` / `finalizeContributionSources` / `finalizeExplainabilityMvpEnvelope`**, and AI Studio placeholder behavior.
