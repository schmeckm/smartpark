# Open-Meteo Weather (`weather_open_meteo`)

Park-level weather polling via [Open-Meteo](https://open-meteo.com/) (no API key). Produces normalized adapter observations with `domain: weather` and `assetSlug: current` for Sparkplug MQTT output, optional human-readable TPUNS topics, and downstream ML feature pipelines.

**Install default:** new installs use `outputProfiles` `["SPARKPLUG_JSON","CANONICAL_HISTORIAN"]` unless you override them in the UI or `install-local` body.

**UNS Live:** the API fills the live buffer from adapter publishes even when `MQTT_ENABLED` is false or the broker is down, so **Run preview** with **MQTT publizieren** still shows rows. The UNS Live filter uses the park slug from topics: for **UNS_JSON**, the server uses **`sparkplugGroupId` when set**, otherwise `context.parkSlug`, so TPUNS paths stay aligned with Sparkplug (`spBv1.0/{sparkplugGroupId}/…`) even if `configJson.parkSlug` differs. Still match your integration **`unsParkKey`** (e.g. `europa_park`).

**Real MQTT (e.g. MQTT Explorer):** `MQTT_ENABLED=true` and a reachable **`MQTT_BROKER_URL`**. In Docker, the broker URL must be **`mqtt://mqtt:1883`** (service name), not `127.0.0.1` (that points inside the container, not your PC). From your machine, subscribe to **`localhost:1883`** if port 1883 is published from Compose.

## UI defaults (`manifest.json`)

The integration UI merges manifest starters into empty/partial YAML:

- **`configSchema.properties.*.default`** — e.g. Europa-Park centroid lat/lon, `parkSlug`, `timezone`.
- **`defaultContextJson`** — `sparkplugGroupId` + `sparkplugEdgeNode` (`weather_gateway`).
- **`defaultScheduleCron`** — `*/10 * * * *` when no cron is saved yet.

## Configuration (`configSchema`)

| Field       | Required | Description                                      |
|------------|----------|--------------------------------------------------|
| `parkSlug` | yes      | Park identifier in observations; prefer same slug as UNS / `sparkplugGroupId` (e.g. `europa_park`) |
| `latitude` | yes      | Park centroid latitude                           |
| `longitude`| yes      | Park centroid longitude                          |

**Same coordinates for the built-in scheduler:** `WeatherOpenMeteoSchedulerService` resolves GPS in this order: `parks.latitude/longitude` → PARK-type `park_assets` → **this install’s** `configJson`/`contextJson` in `data/adapter-install-config/weather_open_meteo.install.yaml` (only if `parkSlug` / `sparkplugGroupId` matches the park, or if no binding is set). Platform setting `WEATHER_OPEN_METEO_ENABLED` only turns scheduling on/off — it does not store coordinates.
| `timezone` | no       | IANA zone for Open-Meteo, default `Europe/Berlin` |

Coordinates should match the park entity from ThemeParks.wiki (`location.latitude` / `location.longitude`) — **one weather station per park**, not per ride.

## Outputs

- **Observations**: `WEATHER_OBSERVED` with metrics `temperature`, `rain_probability`, `rain_mm`, `wind_speed`, `weather_condition`.
- **Preferred outputProfiles**: `["SPARKPLUG_JSON", "CANONICAL_HISTORIAN"]` for MQTT Sparkplug + historian pipeline.
- **Sparkplug JSON** topic: `spBv1.0/{sparkplugGroupId}/DDATA/{sparkplugEdgeNode}/current`.
- **Optional TPUNS JSON** topic: `tpuns/{parkSlug}/v1/weather/current/{metric}`.

Recommended context example:

```json
{
  "parkSlug": "europapark",
  "sparkplugGroupId": "europa_park",
  "sparkplugEdgeNode": "weather_gateway"
}