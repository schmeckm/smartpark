# School Holiday Calendar (`calendar_school_holidays`)

This adapter generates daily holiday-related demand signals for park planning.

It is local-only (no HTTP calls) and reads maintained date windows from YAML files.

## What this adapter is for

Use this adapter when you want stable calendar features for:

- staffing and operations planning
- demand forecasting
- ML feature pipelines

The current package focuses on:

- `DE-BW` (Baden-Wuerttemberg school holidays + public holidays)
- `FR-Grand Est` (school holidays)
- `CH-BS` (school holidays)

## What you get (metrics)

- `is_holiday_de_bw`
- `is_holiday_fr_grandest`
- `is_holiday_ch_bs`
- `is_weekend`
- `iso_weekday` (`1` = Monday, `7` = Sunday)
- `is_public_holiday_de_bw`
- `bridge_day`
- `holiday_score`

If you need wider country/state coverage (e.g. all German states), use `calendar_demand` in addition or instead.

## Quick start

1. Install the adapter in Devices and Services.
2. Keep recommended outputs: `["SPARKPLUG_JSON","CANONICAL_HISTORIAN"]`.
3. Set `parkSlug` and optional `timezone`.
4. Run preview / run now and verify metrics in Operations Center.

## Configuration (`configSchema`)

| Field | Required | Meaning |
|---|---|---|
| `parkSlug` | yes | Park key used in topic paths and observation context. |
| `timezone` | no | Timezone used for day evaluation (default `Europe/Berlin`). |
| `dateOverride` | no | Test date (`YYYY-MM-DD`) for deterministic previews/backfills. |

## Context fields (`contextJson`)

Common fields:

- `sparkplugGroupId`
- `sparkplugEdgeNode` (often `calendar_gateway`)
- `parkSlug` (optional fallback)

Example:

```json
{
  "parkSlug": "europapark",
  "sparkplugGroupId": "europa_park",
  "sparkplugEdgeNode": "calendar_gateway"
}
```

Sparkplug topic example:

`spBv1.0/europa_park/DDATA/calendar_gateway/current`

## Where data comes from

Source files:

- `data/calendar-holidays/de_bw.yaml`
- `data/calendar-holidays/fr_grandest.yaml`
- `data/calendar-holidays/ch_bs.yaml`

Important: `0` values are normal on non-holiday weekdays.  
To validate the pipeline quickly, set `dateOverride` to a known holiday window.

## UI defaults (`manifest.json`)

When installing from UI, missing values are prefilled from the package manifest:

- `configSchema.properties.*.default` -> `configJson`
- `defaultContextJson` -> `contextJson`
- `defaultScheduleCron` -> scheduler default (if not set)

## Operations note

Review and update holiday YAML windows regularly (typically yearly) to keep predictions accurate.

## Fehlerbilder & Loesung

### 1) Immer nur 0-Werte

Pruefen:

- Datum liegt wirklich in einem Holiday-Window?
- Testweise `dateOverride` auf bekannten Ferientag setzen.
- YAML-Dateien unter `data/calendar-holidays/` enthalten korrekte Zeitfenster.

### 2) Kein Event im Operations Center

Pruefen:

- Adapter aktiviert und Scheduler/Run ausgefuehrt.
- Output-Profile gesetzt (empfohlen: `SPARKPLUG_JSON`, `CANONICAL_HISTORIAN`).
- Filter im Dashboard/Pipeline Tail nicht zu eng.

### 3) Topic/Context passt nicht zum Park

Pruefen:

- `parkSlug` in `configJson`
- `sparkplugGroupId` und `sparkplugEdgeNode` in `contextJson`
- erwarteter UNS-/Sparkplug-Namespace
