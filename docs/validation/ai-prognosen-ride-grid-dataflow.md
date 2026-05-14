# Prognosen (Ride-Wartezeiten-Grid) — Datenfluss & Features

Zielgruppe: **„Wartezeiten — Ist & Prognose“** (`/ai-insights`, `AiRideWaitGridView.vue`). Architektur-Referenz: `docs/adr/0001-forecast-architecture.md`.

---

## 1. End-to-End (UI → API → Pipeline)

```mermaid
flowchart TB
  subgraph UI["Admin-Dashboard · AiRideWaitGridView"]
    PC[Park-Kontext · activeParkId]
    GRID[Tabellen-Grid +15/+60]
    DET[Detail · Chart · Erklärbarkeit]
  end

  subgraph APIs["REST (Auszug)"]
    A1["GET …/platform/assets?assetTypeCode=RIDE"]
    A2["GET …/ai/parks/:extPark/entities/forecast/summary"]
    A3["GET …/ai/entities/:extEntity/forecast/summary"]
    A4["GET …/ai/timeseries/rides-current"]
    A5["GET …/integrations/settings"]
    A6["GET …/canonical/messages?WAIT_TIME_UPDATED"]
    A7["GET …/ai/entities/…/forecast/explanation"]
    A8["GET …/ml/predict/rides/:rideId"]
    A9["GET …/ai/factor-configs"]
    A10["GET …/ml/forecast-accuracy/…"]
  end

  subgraph SOR["Persistenz / SoR"]
    PA[(park_assets)]
    RFS[(ride_feature_snapshots_5m)]
    PFS[(park_feature_snapshots_5m)]
    CIM[(canonical_inbound_messages)]
    AS_APP[(app_settings · ai.forecast.factorConfigs)]
    INT[(integration_settings)]
    MLG[(ml_global_factors)]
    MLP[(ml_park_factors)]
    MLPF[(ml_profiles + effektive Ride-Konfig)]
    REG[(ml_model_versions / Ridge-Modelle)]
  end

  subgraph PIPE["AiParkForecastService Pipeline"]
    B[Baseline aus Zeitreihe<br/>Slope +15/+60]
    F[Faktor-Gewichtung UI-Konfig<br/>getFactorConfigs]
    X[X-Layer · applyXLayerToForecast]
    L[L1/L2/L3 · mergeMlEnterpriseLayer]
  end

  subgraph RIDGE["Ride Ridge · predictRideWaitTimes"]
    RV[Feature-Vektor aus Snapshot]
    R1[Ride-spezifisches Ridge]
    R2[Globals Ridge]
    RB[Baseline snapshot-only]
  end

  PC --> GRID
  GRID --> A1 & A2 & A4 & A5 & A6 & A9 & A10
  GRID -. fehlende Bulk-Zeilen .-> A3
  DET --> A7 & A8 & A10

  A1 --> PA
  A2 & A3 --> PIPE
  A4 --> RFS
  A5 --> INT
  A6 --> CIM
  A9 --> AS_APP
  A10 --> RFS

  PIPE --> B --> F --> X --> L
  B --> RFS
  X --> PFS & RFS
  L --> MLG & MLP & MLPF & PFS & RFS

  A8 --> RIDGE
  RIDGE --> RV --> R1 & R2 & RB
  R1 & R2 --> REG
  RV --> RFS
```

---

## 2. Reihenfolge im Forecast-Summary (ADR-konform)

```mermaid
flowchart LR
  S1[Zeitreihe wait<br/>ENTITY → TYPE-Pool → PARK] --> S2[Baseline +15/+60]
  S2 --> S3[Legacy UI-Faktoren<br/>ai.forecast.factorConfigs]
  S3 --> S4[X-Layer Heuristiken<br/>Wetter/Kalender/…]
  S4 --> S5[ML Enterprise Layer<br/>Globale + Park-Faktoren + effektives Profil]
```

---

## 3. „Aktuelle Wartezeit“ im Grid (Priorität)

```mermaid
flowchart TD
  C1[Canonical WAIT_TIME_UPDATED<br/>pro externalEntityId]
  C2[rides-current API]
  C3[Summary currentAvgWaitMinutes]
  C4[Summary currentWaitMinutes]
  C5[Asset-Sync-Snapshot Feld]
  OUT[Ist-Anzeige]

  C1 --> OUT
  C2 --> OUT
  C3 --> OUT
  C4 --> OUT
  C5 --> OUT
```

Implementierung: `currentWaitForRow()` in `AiRideWaitGridView.vue`.

---

## 4. Realisierte Feature-/Signal-Gruppen (operativ im Flow)

### 4.1 Feature Store (5m-Snapshots) — Basis für Baseline & Ridge

Aus `ride_feature_snapshots_5m` / `park_feature_snapshots_5m` (Befüllung u. a. über `AiFeatureStoreService` aus Canonical + Park-Kontext), u. a.:

| Bereich | Beispiele (camel/snake im Code) |
|--------|-----------------------------------|
| Wartezeit | `waitTime`, Rollings, `currentWaitTimeMin` |
| Kapazität | `theoreticalCapacityPph` |
| Personal | `staffingGapNormal` |
| Qualität | `completenessScore`, `trainingEligible`, `forecastEligible`, `dataQualityReason` |
| Park-Kontext | `temperatureC`, `precipitationMm`, `rainProbabilityPercent`, `windSpeedKmh`, `weatherCondition` |
| Kalender | `isPublicHoliday`, `isSchoolHoliday`, `holidayName`, `isWeekend`, `month` |
| Betrieb | `withinScheduledOperatingHours`, `scheduledOperatingSnapshotAt` |
| Crowd | `parkCrowdIndex`, `trafficIndex` (optional / `not_configured`) |
| Profil-Sensitivität | `rainSensitive` (Rain-Bump Guard) |

X-Layer nutzt strukturiert u. a. Wetter, Kalender, Traffic, Öffnungszeiten, Saison, Staffing, Kapazität, Park-Crowd (`ai-forecast-x-adjustments.service.js`).

### 4.2 ML Enterprise Layer (L1/L2/L3) — globale / Park-Codes

Aus `mergeMlEnterpriseLayer` (`ml-forecast-layer.service.js`), typische **Factor-Codes** (wenn in DB aktiv und Snapshot-Kontext passt):

- `HOLIDAY_PRESSURE`, `SCHOOL_BREAK_PRESSURE`, `WEEKEND_UPLIFT`, `SUMMER_SEASON_FACTOR`
- `RAIN_DEMAND_SHIFT` (mit Profil `rainImpactScore` / Regen-mm)
- `MACRO_TOURISM_INDEX`
- `QUEUE_ELASTICITY` (Profil `queueElasticityScore`)
- `ML_CONFIG` (Warnhinweise aus effektiver Konfig)

Globale Faktoren: `ml_global_factors`. Park-Overrides: `ml_park_factors`. Effektives Ride-Profil: `resolveEffectiveMlConfig` → `ml_profiles` + Asset-Verhalten.

### 4.3 Legacy UI-Faktoren (zusätzliche Gewichtung)

`app_settings` · `ai.forecast.factorConfigs` (Fallback `DEFAULT_AI_FACTOR_CONFIGS`) — modifiziert **nach** reiner Slope-Baseline, **vor** X/ML-Layer in `buildFromSeries` / `applyFactorAdjustments`.

### 4.4 Ridge-Pfad (Detail „Ridge“)

`ride-prediction.service.js` + `ride-feature-vector.util` (`TRAINING_FEATURE_NAMES`): trainierte Gewichte aus `ml_model_versions` / Registry, sonst Global- oder Baseline-Zweig.

### 4.5 Settings / Integration

- **Integration settings**: u. a. gewählter **Provider** (`themeparks_wiki`) für Forecast- und Canonical-Calls.
- **Park**: `externalEntityId` (ThemeParks-Park-ID) zwingend für Bulk-Forecast `…/entities/forecast/summary`.

---

## 5. Kurzreferenz Dateien

| Teil | Datei |
|------|--------|
| UI | `admin-dashboard/src/views/AiRideWaitGridView.vue` |
| Bulk + Entity Summary | `src/services/ai-park-forecast.service.js` |
| X-Layer | `src/services/ai-forecast-x-adjustments.service.js` |
| ML-Faktoren-Layer | `src/services/ml-forecast-layer.service.js` |
| Snapshots schreiben | `src/services/ai-feature-store.service.js` |
| Ridge Predict | `src/services/ml/ride-prediction.service.js` |
