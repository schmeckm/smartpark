# School Holiday Calendar (`calendar_school_holidays`)

Publishes daily school-holiday demand factors for **DE-BW**, **FR-Grand Est**, and **CH-BS**.

Primary use case: demand-sensitive planning and ML features for park operations.

## Metrics

- `is_holiday_de_bw` — school break windows from YAML (`de_bw.yaml`)
- `is_holiday_fr_grandest` — school break (`fr_grandest.yaml`)
- `is_holiday_ch_bs` — school break (`ch_bs.yaml`)
- `is_weekend` — Sat/Sun in configured `timezone`
- `iso_weekday` — **1 = Monday … 7 = Sunday** (for ML / feature parity with park snapshots)
- `is_public_holiday_de_bw` — **Baden-Württemberg statutory public holidays** (fixed dates + Easter-based: Karfreitag, Ostermontag, Himmelfahrt, Pfingstmontag, Fronleichnam, etc.) without HTTP
- `bridge_day` — working day between weekend or (school **or** BW public) holiday
- `holiday_score` — weighted blend (includes public-holiday uplift)

For **all German Länder / FR / CH public holidays** via Nager, use **`calendar_demand`** instead or in addition.

## Recommended output profiles

```json
["SPARKPLUG_JSON", "CANONICAL_HISTORIAN"]
```

UNS JSON remains supported as optional human-readable output.

## Sparkplug target topic

With this context:

```json
{
  "parkSlug": "europapark",
  "sparkplugGroupId": "europa_park",
  "sparkplugEdgeNode": "calendar_gateway"
}
```

the Sparkplug encoder publishes to:

`spBv1.0/europa_park/DDATA/calendar_gateway/current`

## Configuration (`configSchema`)

| Field | Required | Description |
|---|---|---|
| `parkSlug` | yes | Park slug / UNS segment |
| `timezone` | no | Local timezone for date evaluation (`Europe/Berlin` default) |
| `dateOverride` | no | Optional `YYYY-MM-DD` for deterministic tests/backfills (use a date inside a YAML window to see non-zero factors) |

## Data source

- **No HTTP**: run preview shows **READ** rows for `data/calendar-holidays/{de_bw,fr_grandest,ch_bs}.yaml` (same files as the **Calendar Demand** adapter). Edit those YAML files to change windows.
- **Zeros are normal** on dates that fall outside every school window and are not a weekend (e.g. many weekdays in May). Check the YAML ranges or set `dateOverride` to e.g. `2026-05-26` (start of a DE-BW window) to confirm MQTT values.

## UI defaults (`manifest.json`)

The admin integration screen **pre-fills** empty or partial install YAML from the package manifest:

- **`configSchema.properties.*.default`** → merged into **configJson** (only keys you have not saved yet).
- **`defaultContextJson`** → merged into **contextJson** (adds `sparkplugGroupId` / `sparkplugEdgeNode` when missing).
- **`defaultScheduleCron`** → used when **scheduleCron** is not set in YAML (`0 3 * * *` = daily 03:00).

Adjust these in `manifest.json` if your park slug or Sparkplug namespace differs.

## Notes

- Adapter is fully local (no external API). Preview **API calls** counts YAML **READ** steps, not ThemeParks-style HTTP.
- Review `data/calendar-holidays/*.yaml` yearly against official school calendars.
