# TomTom Traffic (`traffic_tomtom`)

Modular **traffic provider adapter** for Smart Park OS. It registers in **Devices & Services** like other adapter packages.

## Credentials

- API keys are **not** stored in `configJson` / install YAML (those files are not suited for secrets).
- The server persists an encrypted row in `traffic_provider_configs` with `provider_key = traffic_tomtom`.
- Edit the key in **Devices & Services → this adapter → Traffic API** or on **Integration settings → Traffic providers** (same data).

## Runtime

- **Health** checks that TomTom is enabled and a decryptable key exists.
- **Poll** calls the same backend path as `POST /api/v1/traffic/snapshots/poll`: for each **enabled** corridor with valid origin/destination coordinates it requests TomTom routing, computes congestion metrics, persists `TrafficCorridorSnapshot5m`, and returns adapter **observations** (plus a per-corridor summary in `debug.results`). Optional park filter: UUID `parkId` / `externalParkId`, or `parkSlug` in install context; if none of these resolve to a park, **all** enabled corridors are polled (same as an empty HTTP poll body).

## Adding another vendor (e.g. Google)

Add a new package (e.g. `traffic_google`), a new `traffic_provider_configs` row key, provider implementation, and API routes — same pattern as this adapter.
