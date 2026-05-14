# Smart Park OS (Backend MVP)

> **Three entry points, depending on what you need:**
>
> - [`PRODUCT.md`](PRODUCT.md) — business / product overview (value
>   proposition, modules, target markets, roadmap, pricing tiers).
> - [`BUILD.md`](BUILD.md) — structured developer guide *("Wie baue ich es?")*:
>   first integration, adapter contract, frontend cards, AI hooks,
>   simulator, governance checks.
> - This `README.md` — technical reference (architecture details, env
>   variables, REST surface, MQTT topics, Docker Compose).

Smart Park OS is an operations-oriented API for large venues (amusement parks, resorts, stadiums, zoos). This MVP focuses on **visitor flow signals** that drive **workforce and operations recommendations**, with **realtime** updates over **Socket.IO**.

## Architecture

- **HTTP**: Express routes delegate to **controllers**, which call **services** for business rules and **repositories** for persistence.
- **Data**: PostgreSQL via **Sequelize** (models, migrations, seeders).
- **Realtime**: Socket.IO emits when **zones**, **crowd events**, or **recommendations** change.
- **Docs**: OpenAPI 3 served with Swagger UI at `/api/v1/docs`.
- **Observability**: Structured logs with **Pino** (request IDs via `x-request-id` or generated).

### Architecture decisions (ADRs)

Normative docs live under **`docs/adr/`**. Start with **[ADR 0001 — Forecast & ML feature architecture](docs/adr/0001-forecast-architecture.md)** (data flow, system of record, guardrails). **Do not add parallel forecast pipelines** without updating that ADR.

### Crowd spike evaluation

When `POST /api/v1/events` creates a `CROWD_SPIKE` and `crowdLevel` exceeds **75%** of the zone `maxCapacity`, the engine may create:

- **REALLOCATE_STAFF** if **FOOD_SERVICE** staff are **available** in an **adjacent** zone that is materially calmer.
- **SEND_SECURITY** if **severity ≥ 4** or crowd pressure **≥ 90%** of capacity.
- **GUEST_ROUTING** if any **OPEN** ride in the zone has **waitTime > 45** minutes.

Zones include `adjacentZoneIds` (UUID array) to model neighborhood relationships for staffing suggestions.

## Requirements

- Node.js **20+** (LTS track recommended; Docker image uses Node 22)
- PostgreSQL **14+** (Docker Compose uses 16)
- Docker Desktop (optional, for Compose)

## Admin dashboard (Vue.js)

The **`admin-dashboard/`** app is a Vue 3 + Vite control room: crowd heatmap, rides table, staff-by-zone board, recommendations with **Socket.IO** live updates. In development it proxies `/api` and `/socket.io` to `http://localhost:3000`.

```bash
cd admin-dashboard
npm install
npm run dev
```

Open **http://localhost:5173** with the API running. For production builds against a remote API, set `VITE_API_URL` (see `admin-dashboard/.env.example`).

**Add-on Board — custom signal widgets (L3):** the admin UI can show **custom signal widgets** (picker, draft, read-only tiles) when the build sets **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER=true`**. Treat it as a **rollback switch**: set **`false`** or omit the variable to hide that block without changing stored ride data. Details: **`admin-dashboard/.env.example`** and **`docs/validation/addon-board-signal-source-picker-qa.md`**.

### Database connection refused (`::1:5432`)

If Node tries **IPv6** `::1` but PostgreSQL only listens on **IPv4**, you may see `ECONNREFUSED ::1:5432`. The app maps **`localhost` → `127.0.0.1`** via `config/db-host.js`. Ensure PostgreSQL is running and that `.env` matches your instance (see `.env.example`: `DB_HOST=127.0.0.1` for typical local Windows setups).

## Local setup (without Docker)

1. Create a database and user matching `.env` (copy from `.env.example`).

```bash
cp .env.example .env
```

2. Install dependencies and apply schema + demo data:

```bash
npm install
npm run db:migrate
npm run db:seed
```

3. Start the API:

```bash
npm run dev
```

Health check: `GET http://localhost:3000/health`  
Swagger UI: `http://localhost:3000/api/v1/docs`

## Docker Compose

Start **Docker Desktop** (or your Docker engine) first, then from the project root:

```bash
docker compose up --build
```

The API image installs production dependencies with **`npm ci`**, waits until Postgres accepts connections (`scripts/wait-for-postgres.js`), then runs **migrations** and **seeders** before starting Node. Seeders are tracked in `SequelizeData`; reruns are safe.

- API: **http://localhost:3000**

## Enterprise provider adapter architecture (canonical)

Smart Park OS uses a canonical integration pipeline for external providers:

Provider Adapter -> Canonical Message -> Canonical Store -> Validation -> Mapping -> Domain Apply

Implemented adapters:
- `themeparks_wiki`
- `wartezeiten_app`

Key properties:
- Adapter parsing is provider-specific and isolated in `src/integrations/adapters/`.
- Domain tables are updated only by canonical apply services, not directly by adapters.
- Raw payloads are persisted on every canonical message.
- Failed validations/mappings are persisted (`FAILED` / `NEEDS_REVIEW`) and can be reprocessed.

### Configure providers and target park

Use integration endpoints (Swagger `/api/v1/docs`):
- `GET /api/v1/integrations/providers`
- `PATCH /api/v1/integrations/providers/:provider/config`
- `PATCH /api/v1/integrations/settings`

Settings keys used in DB (`app_settings`):
- `externalParkData.selectedProvider`
- `externalParkData.selectedDestination`
- `externalParkData.selectedPark`
- `externalParkData.autoApplyEnabled`
- `externalParkData.pollingEnabled`
- `externalParkData.pollingIntervalSeconds`

### Mapping external entities

Mappings are stored in `external_entity_mappings`. If no mapping is found:
- message is not applied to internal rides
- mapping status is set to `NEEDS_REVIEW`
- data quality issue is created for operator follow-up

Endpoints:
- `GET /api/v1/integrations/mappings`
- `PATCH /api/v1/integrations/mappings/:id`

### Canonical monitoring and reprocess

Endpoints:
- `GET /api/v1/integrations/canonical/messages`
- `GET /api/v1/integrations/canonical/messages/:id`
- `POST /api/v1/integrations/canonical/messages/:id/reprocess`

Realtime events:
- `canonical:message:received`
- `canonical:message:applied`
- `canonical:message:failed`
- `external:mapping:updated`
- `external:parkdata:updated`

### Polling env vars

```bash
EXTERNAL_PARK_DATA_ENABLED=true
EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS=300
EXTERNAL_PARK_DATA_DEFAULT_PROVIDER=themeparks_wiki
```
- Postgres: **localhost:5432** (user/password/database `smartpark`)

If you see `dockerDesktopLinuxEngine: The system cannot find the file specified`, the Docker engine is not running—start Docker and retry.

## Wave 2 — real-world connectivity (IoT, import, simulator)

- **Eclipse Mosquitto** is included in `docker compose` on ports **1883** (MQTT) and **9001** (WebSocket listener for future clients). The API subscribes when `MQTT_ENABLED=true` and `MQTT_BROKER_URL` points at the broker (e.g. `mqtt://mqtt:1883` in Compose, `mqtt://127.0.0.1:1883` when running the API on the host with `docker compose up -d mqtt`).
- **Topics**: `park/+/zone/+/crowd`, `park/+/ride/+/status`, `park/+/weather`, `park/+/sensor/+` (see `src/services/mqtt-connector.service.js`).

### UNS canonical topics vs Sparkplug B MQTT

Smart Park keeps **two layers** on purpose:

1. **Canonical UNS (TP-UNS) topic** — business-oriented, stable addressing for dashboards, historians, ML features, and event buses:
   `tpuns/{park_slug}/v1/{entity_type}/{entity_slug}/{metric}`  
   Built in code with `buildCanonicalUnsTopic()` / `generateTopicPath()` in `src/modules/uns/uns-topic-generator.service.js`.

2. **Sparkplug B MQTT topic** — wire transport under the Eclipse Sparkplug namespace:
   `spBv1.0/{group_id}/{message_type}/{edge_node_id}/{device_id}` (device segment omitted for node-level types such as `NBIRTH`).  
   Built with `buildSparkplugTopic()` in `src/modules/uns/sparkplug-topic-builder.service.js`. Allowed `message_type` values include `NBIRTH`, `NDEATH`, `DBIRTH`, `DDEATH`, `DDATA`, `NCMD`, `DCMD`, `STATE`.

**Why metrics sit in the Sparkplug payload:** In Sparkplug B, `status`, `queue_time`, `cycle_start`, and similar signals are **metrics** inside the NBIRTH/DBIRTH/DDATA payload, not extra MQTT topic levels. The device id in the topic identifies the attraction or restaurant edge device; many UNS metrics map to the **same** DDATA topic with different `metrics[].name` entries.

**From MQTT to canonical consumers:** A bridge or subscriber can read Sparkplug DDATA (JSON MVP today), fan out **synthetic** UNS-shaped events by combining `tags.canonicalUnsTopic` (when present) or by joining `{park, domain, asset, metric}` from tags + observation into `tpuns/...` keys for dashboard subscriptions, historian writes, and ML feature pipelines — without changing the adapter canonical model.

Environment (see `.env.example`): `SPARKPLUG_GROUP_ID` (empty → API defaults group id to UNS park slug), `SPARKPLUG_EDGE_NODE` (default `park_gateway`).

### Canonical-to-Sparkplug Publisher

Cloud and REST adapters (ThemeParks.wiki, weather, traffic, etc.) emit **canonical inbound messages** only. The service **`src/services/canonicalToSparkplugPublisher.js`** turns those (and merged live batches) into **Sparkplug B–shaped MQTT** (`DBIRTH` for device metadata, then `DDATA` with a `metrics` array — never `queue_time` in the topic path). It is invoked after **entity** and **live** integration sync so adapter traffic uses the same MQTT backbone as future PLC/edge devices. Optional **`publishDdeath`** is available when a device drops out of the catalog.

Example **DBIRTH** metrics (device = attraction id, topic `…/DBIRTH/…/euro_mir`): `entity_type`, `display_name`, `theoretical_capacity`, `max_seats_per_cycle`, `expected_cycle_time_seconds`.

Example **DDATA** metrics (rides, same device id as UNS asset slug): `status`, `queue_time`, `cycle_start`, `cycle_end`, `guests_per_cycle`, `train_count`, `actual_throughput`, `ride_efficiency`.

Example **DDATA** metrics (restaurants, device e.g. `foodloop`): `status`, `seats_capacity`, `seats_occupied`, `avg_dwell_time`, `staff_count`, `orders_per_hour`, `throughput` — with canonical UNS leaves such as `tpuns/{park}/v1/restaurants/foodloop/status` for historian/dashboard subscriptions.

**DDEATH** uses the same device channel topic pattern with message type `DDEATH` when the device goes offline.
- **New tables** (migrations): `integration_event_logs`, `weather_observations`, `data_quality_issues`.
- **API** (all under `/api/v1` with normal auth + RBAC): `GET /mqtt/status`, `GET /integration/logs`, `GET/POST /weather/...`, `POST /import/{staff,rides,zones}` (multipart `file`), `GET/PATCH /data-quality/issues...`, `GET/POST /simulator/...`.
- **Admin UI**: **Live ops**, **Import**, **Data quality**, **Simulator** in the nav (where your role has access).

Run migrations after pulling:

```bash
npm run db:migrate
```

## Socket.IO events

Connect to the same origin/port as the API (CORS is configurable via `CORS_ORIGIN`).

| Event                     | Payload shape                                      |
| ------------------------- | -------------------------------------------------- |
| `zones:updated`           | `{ zone }`                                         |
| `events:created`          | `{ event }`                                        |
| `recommendations:created` | `{ recommendation }`                               |
| `recommendations:updated` | `{ recommendation }`                               |
| `mqtt:status`             | `{ enabled, connected, lastError, broker, clientId }` |
| `integration:ingested`    | `{ id, eventType, status, topic, ... }`            |
| `weather:updated`         | `{ observation }`                                  |
| `dataquality:new`         | `{ issue }`                                        |
| `simulator:tick`          | `{ scenario, ok, at, error? }`                    |

## REST surface (`/api/v1`)

| Area            | Endpoints                                                                 |
| --------------- | ------------------------------------------------------------------------- |
| Zones           | `GET/POST /zones`, `GET/PATCH/DELETE /zones/:id`                          |
| Rides           | `GET/POST /rides`, `GET/PATCH/DELETE /rides/:id`                          |
| Staff           | `GET/POST /staff`, `GET/PATCH/DELETE /staff/:id`                          |
| Events          | `GET /events`, `POST /events`                                               |
| Recommendations | `GET /recommendations`, `PATCH /recommendations/:id/status`               |
| Dashboard       | `GET /dashboard/summary`                                                    |

### Example: create a crowd spike

```bash
curl -s -X POST http://localhost:3000/api/v1/events ^
  -H "Content-Type: application/json" ^
  -d "{\"zoneId\":\"b1000001-0000-4000-8000-000000000002\",\"eventType\":\"CROWD_SPIKE\",\"crowdLevel\":8000,\"severity\":3,\"source\":\"simulator\"}"
```

Set `"syncZone": false` if you do not want `currentCrowdLevel` updated from `crowdLevel`.

## Demo dataset

The seeder models a fictional **Alpenresort Kingdom**-style park: themed **zones**, **rides** (including a high-wait coaster in **Alpine Summit**), **staff** across roles, sample **events**, and **recommendations**.

## Scripts

| Script          | Purpose                              |
| --------------- | ------------------------------------ |
| `npm start`     | Run `server.js`                      |
| `npm run dev`   | Run with Nodemon                     |
| `npm run db:migrate` | Run pending migrations          |
| `npm run db:seed`    | Run pending seeders             |
| `npm run db:reset`   | Undo all migrations, migrate, seed |

## License

Private / unlicensed MVP — adjust for your organization.
# smartpark
