# Weather adapter (park level)

## Role

The **Open-Meteo weather** adapter (`weather_open_meteo`) supplies **park-level** environmental context for analytics and ML: temperature, precipitation likelihood and amount, wind, and a coarse weather condition. It uses **only park GPS** (latitude, longitude, and IANA timezone) — the same fields you already get from **ThemeParks.wiki** entity documents for each park.

## Why park coordinates are enough

Rides sit inside the park; mesoscale weather for the park does not need per-ride coordinates. ThemeParks.wiki `location.latitude`, `location.longitude`, and `location.timezone` are sufficient to query Open-Meteo once per park.

## How weather fits the pipeline

1. **Polling** produces normalized observations (`WEATHER_OBSERVED`, `domain: weather`, `assetSlug: current`) with one metric per row.
2. **UNS JSON** topics (when `context.parkSlug` is set) follow:

   `tpuns/{parkSlug}/v1/weather/current/{metric}`

   Example: `tpuns/europapark/v1/weather/current/temperature`.

3. **Latest park-level state** should be stored or cached by your ingest/snapshot layer (for example keyed by `parkSlug` + metric). Weather is **not** written into every queue-time or ride event payload.
4. **ML feature snapshots** join the latest weather row (or a small time window) when building features — keeping queue streams lean and avoiding redundant denormalization.

## What this adapter does *not* do

- It does **not** attach weather to each queue-time update.
- It does **not** use per-ride coordinates (by design).
- It does **not** change the ThemeParks.wiki integration; you continue to source park metadata there and pass `latitude`, `longitude`, `timezone`, and `parkSlug` into adapter config / runtime `context`.

## Configuration

See `src/integrations/adapter-packages/weather_open_meteo/README.md` and `manifest.json` `configSchema`. Required: `parkSlug`, `latitude`, `longitude`. Optional: `timezone` (default `Europe/Berlin`).

## Smoke test

```bash
npm run smoke:weather-adapter
```

Uses `emit: false`, asserts a temperature observation, a UNS topic segment `/weather/current/temperature`, and absence of queue-time-like observations from this run.
