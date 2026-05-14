# Smart Park OS — Build Guide

> **Wie baue ich auf Smart Park OS?**
> Dieser Guide ist die strukturierte Antwort: vom ersten `npm install` über
> deine erste Integration bis zu Frontend-Erweiterungen, Plattform-Services
> und Operator-Tooling.

| Schnell-Einstieg | Was du danach hast |
|---|---|
| [1 — Lokale Umgebung](#1-lokale-umgebung-aufsetzen) | API + Postgres + MQTT + Admin-Dashboard laufen |
| [2 — Erste Integration](#2-erste-integration-bauen) | Eigener Adapter liefert kanonische Observations |
| [3 — Live-Daten ansehen](#3-live-daten-ansehen) | Sparkplug B / UNS / Canonical Inbox sichtbar |
| [4 — Frontend-Karte](#4-frontend-erweitern-eigene-karte) | Eigenes Vue-3-Widget im Cockpit |
| [5 — Empfehlungen / KI](#5-empfehlungen--ki-anbinden) | Forecast & Recommendations konsumiert |
| [6 — Veröffentlichen](#6-veröffentlichen--zertifizieren) | Adapter-Paket reviewbar & deploybar |

---

## Inhalt

- [Getting Started](#getting-started)
  - [1 — Lokale Umgebung aufsetzen](#1-lokale-umgebung-aufsetzen)
  - [Voraussetzungen](#voraussetzungen)
  - [Installation (ohne Docker)](#installation-ohne-docker)
  - [Docker Compose](#docker-compose)
  - [MQTT-Broker verbinden](#mqtt-broker-verbinden)
  - [Smoke-Tests](#smoke-tests)
- [Core Concepts](#core-concepts)
  - [Architektur in einem Bild](#architektur-in-einem-bild)
  - [Canonical Message Model](#canonical-message-model)
  - [Event-Bus (MQTT / Sparkplug B / UNS)](#event-bus-mqtt--sparkplug-b--uns)
  - [Registry & Master Data](#registry--master-data)
  - [Security Model (RBAC, JWT, Park-Kontext)](#security-model-rbac-jwt-park-kontext)
- [Integration Development](#integration-development)
  - [2 — Erste Integration bauen](#2-erste-integration-bauen)
  - [Adapter-Lifecycle](#adapter-lifecycle)
  - [Konfiguration & Manifest](#konfiguration--manifest)
  - [Data Mapping](#data-mapping)
  - [Best Practices](#best-practices)
  - [Testing](#testing-adapter)
  - [6 — Veröffentlichen & zertifizieren](#6-veröffentlichen--zertifizieren)
- [Frontend Development](#frontend-development)
  - [UI Overview](#ui-overview)
  - [4 — Frontend erweitern (eigene Karte)](#4-frontend-erweitern-eigene-karte)
  - [Component SDK / Built-in Components](#component-sdk--built-in-components)
  - [Data Binding (Pinia, Socket.IO)](#data-binding-pinia-socketio)
- [Platform Services](#platform-services)
  - [API Reference](#api-reference)
  - [Webhooks & Realtime](#webhooks--realtime)
  - [Authentication](#authentication)
  - [File Upload / Import](#file-upload--import)
  - [Alerting & Daten-Qualität](#alerting--daten-qualität)
- [AI / ML](#ai--ml)
  - [5 — Empfehlungen / KI anbinden](#5-empfehlungen--ki-anbinden)
  - [Forecast Pipeline](#forecast-pipeline)
  - [Feature Store](#feature-store)
- [Tools & Resources](#tools--resources)
  - [3 — Live-Daten ansehen](#3-live-daten-ansehen)
  - [Simulator](#simulator)
  - [CLI-Skripte (`npm run …`)](#cli-skripte-npm-run-)
  - [Governance & Drift-Checks](#governance--drift-checks)

---

## Getting Started

### Voraussetzungen

- **Node.js 20+** (Repo-Engine; Docker-Image nutzt Node 22)
- **PostgreSQL 14+** (Docker Compose nutzt 16)
- **Docker Desktop** (optional, aber empfohlen für `mqtt`-Broker und DB)
- **Git** + ein Editor (VS Code / Cursor mit Volar für `.vue`)
- Optional: **MQTT-Client** wie [`MQTT Explorer`](http://mqtt-explorer.com/)
  zum Mitlesen auf `tpuns/...` und `spBv1.0/...`

### 1 — Lokale Umgebung aufsetzen

```bash
git clone <dein-fork>
cd "Smart Park"

cp .env.example .env

npm install
npm --prefix admin-dashboard install
```

Wichtige `.env`-Werte (siehe `.env.example`):

| Variable | Sinn |
|---|---|
| `DB_HOST=127.0.0.1` | IPv4 erzwingen (Windows-Falle: `::1` schlägt fehl) |
| `DB_PORT=15432` | Compose mappt Postgres auf 15432 |
| `JWT_SECRET=...` | langer Random-String, ohne läuft Auth nicht produktiv |
| `MQTT_ENABLED=true` | aktiviert MQTT-Connector |
| `MQTT_BROKER_URL` | `mqtt://127.0.0.1:1883` (Host) bzw. `mqtt://mqtt:1883` (Compose) |
| `WEATHER_OPEN_METEO_ENABLED` | aktiviert produktiven Wetter-Adapter |

### Installation (ohne Docker)

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

- API: <http://localhost:3000>
- Health: <http://localhost:3000/health>
- Swagger UI: <http://localhost:3000/api/v1/docs>

```bash
npm --prefix admin-dashboard run dev
```

- Admin-Dashboard: <http://localhost:5173>
  (Vite proxyed `/api` und `/socket.io` auf Port 3000.)

### Docker Compose

```bash
docker compose up --build
```

Das Compose-Setup startet **API**, **Postgres**, **Mosquitto** (MQTT auf
1883, WS auf 9001), wartet auf die DB, fährt Migrations + Seeds und
startet dann Node. Re-runs sind idempotent (`SequelizeData`).

### MQTT-Broker verbinden

1. `MQTT_ENABLED=true` in `.env`
2. `MQTT_BROKER_URL` setzen
   - lokal: `mqtt://127.0.0.1:1883`
   - in Compose-Netz: `mqtt://mqtt:1883`
3. API neu starten, dann in der Admin-UI **Live ops → MQTT status**
   prüfen, oder REST: `GET /api/v1/mqtt/status`.

Topics, die du mitlesen kannst:

```text
tpuns/{park}/v1/{entity_type}/{entity_slug}/{metric}      # UNS (business)
spBv1.0/{group_id}/{message_type}/{edge_node}/{device}    # Sparkplug B
park/+/zone/+/crowd                                        # legacy demo
```

### Smoke-Tests

Schneller Sanity-Check der wichtigsten Pfade ohne UI:

```bash
npm run smoke:adapter-runtime          # generischer Adapter-Pfad
npm run smoke:adapters                 # scanPackages + poll + encode
npm run smoke:weather-adapter          # Open-Meteo end-to-end
npm run smoke:euromir-e2e              # ThemeParks → canonical
npm run smoke:rides-e2e                # Wartezeit-Forecast Pipeline
```

`smoke:*` heißt: läuft offline möglichst weit, schreibt nur in DB wenn
sie erreichbar ist, und ist für CI gedacht.

---

## Core Concepts

### Architektur in einem Bild

```text
   Quellen                   Bus                  Speicher              Konsumenten
+---------------+      +---------------+     +-----------------+     +-------------+
| Adapter       | ---> | Output Router | --> | Canonical Store | --> | Forecast    |
| (Cloud / API) |      | (UNS_JSON,    |     | + Historian     |     | Engine      |
+---------------+      |  SPARKPLUG,   |     +-----------------+     +-------------+
| Edge / PLC    | ---> |  CANONICAL)   |              |                     |
+---------------+      +-------+-------+              v                     v
                               |                +-----------+         +-------------+
                               +------> MQTT -->| Subscriber|         | REST + WS   |
                                                +-----------+         | (Socket.IO) |
                                                                      +-------------+
```

Vollständige Variante mit Phasen-Legende in
[`docs/architekur.md`](docs/architekur.md).

### Canonical Message Model

Jede externe Nachricht durchläuft denselben Pfad:

```text
Adapter.poll() ──► AdapterObservationValidator
              ──► OutputRouter.encodeAll() ──► UNS_JSON / SPARKPLUG_JSON / CANONICAL_HISTORIAN
              ──► OutputRouter.emit()       ──► MQTT publish + CanonicalInboundMessageService.ingest()
              ──► CanonicalApply (Validation, Mapping, Domain Apply)
              ──► Domain-Tabellen + Realtime-Events
```

Mindestschema einer Observation
(`src/modules/integrations/adapter-framework/adapter-observation.schema.js`):

```json
{
  "eventType": "WAIT_TIME_UPDATED",
  "domain": "rides",
  "assetSlug": "euro_mir",
  "metric": "queue_time",
  "value": 35,
  "eventTime": "2026-05-08T10:00:00Z",
  "source": "themeparks_wiki"
}
```

Optional: `unit`, `quality`, `confidence`, `provider`, `externalParkId`,
`externalEntityId`, `rawPayload`, `metadata`.

Domain-Tabellen werden **nie** direkt vom Adapter geschrieben – immer
nur über den Canonical-Apply-Pfad. Fehlgeschlagene Validierung →
`FAILED`. Fehlendes Mapping → `NEEDS_REVIEW` + Daten-Qualitäts-Issue.

Details: [`docs/adapter-runtime.md`](docs/adapter-runtime.md).

### Event-Bus (MQTT / Sparkplug B / UNS)

Zwei bewusste Schichten:

| Schicht | Rolle | Beispiel |
|---|---|---|
| **Canonical UNS (TP-UNS)** | Stabile, business-orientierte Adresse für Dashboards/ML/Historian | `tpuns/europa_park/v1/rides/euro_mir/queue_time` |
| **Sparkplug B MQTT** | Wire-Transport im Eclipse-Sparkplug-Namespace | `spBv1.0/europa_park/DDATA/park_gateway/euro_mir` |

Wichtig: **Metriken liegen im Sparkplug-Payload**, nicht im Topic. Eine
einzige `DDATA` kann viele `metrics[]`-Einträge tragen
(`status`, `queue_time`, `cycle_start`, …). Der UNS-Topic-Generator
(`src/modules/uns/uns-topic-generator.service.js`) liefert den
Business-Adressraum, der `Canonical-to-Sparkplug-Publisher`
(`src/services/canonicalToSparkplugPublisher.js`) packt ihn in
Sparkplug-Frames.

### Registry & Master Data

Die "goldene" Sicht auf Park-Objekte:

| Konzept | Tabelle / Service |
|---|---|
| Park | `parks` (+ Park-Kontext-Header `X-Park-Id`) |
| Zone | `park_zones` |
| Asset (Ride/Restaurant/Sensor) | `park_assets` + Type-Master (z. B. `ride_master_data`) |
| Adapter-Konfiguration | `provider_adapter_configs` + installierte Pakete |
| Live-State | `uns_latest_state` |
| Wartezeit (Analytics) | `ride_wait_time_samples`, `ride_feature_snapshots_5m` |

Wer "Source of Truth" ist, steht in
[`docs/architecture/source-of-truth.md`](docs/architecture/source-of-truth.md).
**Faustregel:** neuer Code spricht `park_assets` + Master, nicht
`rides`-Legacy.

### Security Model (RBAC, JWT, Park-Kontext)

- **JWT Bearer** auf jedem `/api/v1`-Aufruf (Login → Refresh-Token).
- **RBAC** in `src/constants/rbac.js` + Spiegel im Frontend
  (`admin-dashboard/src/constants/rbac.ts`); Drift-Check via
  `npm run verify:rbac`.
- **Park-Kontext-Header** `X-Park-Id` setzt der API-Client, sobald ein
  aktiver Park gewählt ist; Middleware `attachParkContext` validiert,
  dass der User Zugriff hat.
- **CORS** über `CORS_ORIGIN`. Production: setzen, niemals `*` für
  Browser-Clients mit Cookies.

---

## Integration Development

### 2 — Erste Integration bauen

Adapter sind **lokale Pakete** unter
`src/integrations/adapter-packages/<adapterKey>/`. Du brauchst
zwei Dateien:

```text
src/integrations/adapter-packages/my_first_adapter/
├── manifest.json
└── index.js
```

**`manifest.json`**

```json
{
  "adapterKey": "my_first_adapter",
  "name": "My First Adapter",
  "description": "Demo: liefert eine synthetische Wartezeit pro Ride.",
  "version": "0.1.0",
  "runtime": "NODE",
  "entrypoint": "index.js",
  "adapterType": "RIDE_TIMES",
  "iotClass": "cloud_polling",
  "capabilities": ["POLLING", "UNS_OUTPUT", "FEATURE_OUTPUT"],
  "providedDomains": ["rides"],
  "providedMetrics": ["queue_time"],
  "defaultScheduleCron": "*/5 * * * *",
  "configSchema": {
    "type": "object",
    "properties": {
      "parkSlug": { "type": "string", "default": "europa_park" },
      "rideSlug": { "type": "string", "default": "euro_mir" }
    },
    "required": ["parkSlug", "rideSlug"]
  },
  "permissions": { "network": false, "mqttPublish": false, "databaseWrite": false }
}
```

**`index.js`**

```js
async function validateConfig(config) {
  const errors = [];
  if (!config?.parkSlug) errors.push('parkSlug is required');
  if (!config?.rideSlug) errors.push('rideSlug is required');
  return { valid: errors.length === 0, errors };
}

async function discover(config) {
  return [{ assetSlug: config.rideSlug, kind: 'RIDE' }];
}

async function poll(config) {
  const queueTime = Math.round(20 + Math.random() * 40);
  return [
    {
      eventType: 'WAIT_TIME_UPDATED',
      domain: 'rides',
      assetSlug: config.rideSlug,
      metric: 'queue_time',
      value: queueTime,
      unit: 'minutes',
      eventTime: new Date().toISOString(),
      source: 'my_first_adapter',
    },
  ];
}

async function health() {
  return { ok: true };
}

module.exports = { validateConfig, discover, poll, health };
```

Lokal ausführen ohne Cron:

```bash
curl -X POST http://localhost:3000/api/v1/integrations/adapters/run-local \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "adapterKey": "my_first_adapter",
    "config": { "parkSlug": "europa_park", "rideSlug": "euro_mir" },
    "profiles": ["UNS_JSON", "SPARKPLUG_JSON", "CANONICAL_HISTORIAN"],
    "emit": true
  }'
```

Was passiert:

1. Loader findet das Paket (`AdapterPackageLoaderService.scanPackages`).
2. `validateConfig` läuft.
3. `poll` liefert eine Observation.
4. `AdapterObservationValidator` prüft Schema.
5. `OutputRouterService.encodeAll` baut UNS + Sparkplug + Canonical-Row.
6. `OutputRouterService.emit` publisht auf MQTT und ingestiert in den
   Canonical Store.
7. Eintrag in `adapter_run_logs`.

### Adapter-Lifecycle

| Phase | Wer ruft auf | Zweck |
|---|---|---|
| **Discover** | UI / API | Welche Entitäten bietet die Quelle? (z. B. Liste der Rides) |
| **Validate** | Loader + Runtime | Manifest + Config korrekt? |
| **Poll** | Scheduler / API / Smoke | Observations holen + an Pipeline übergeben |
| **Health** | Cockpit / Monitoring | Quelle erreichbar? |
| **Map** | Operator | External-ID ↔ kanonisches Asset verknüpfen |
| **Apply** | Canonical-Apply-Service | Domain-Update inkl. Realtime-Event |

Vorhandene Referenzen unter `src/integrations/adapter-packages/`:

- `themeparks_wiki` – externe REST-API → Wartezeiten
- `wartezeiten_app` – alternative Wartezeit-Quelle
- `weather_open_meteo` – Park-Wetter (siehe Manifest-Beispiel oben)
- `calendar_school_holidays` – Schulferien-Profil
- `opcua_edge` – industrieller OPC-UA-Tag-Polling-Stub

### Konfiguration & Manifest

Manifest-Pflichtfelder werden vom
`AdapterManifestValidatorService` durchgesetzt. Wichtige Felder:

- `capabilities` aus `POLLING`, `UNS_OUTPUT`, `FEATURE_OUTPUT`,
  `MQTT_OUTPUT`, …
- `providedDomains` / `providedMetrics` – nutzt das Cockpit für
  Filter & Auto-Mapping-Vorschläge.
- `permissions.network / mqttPublish / databaseWrite` – Sicherheits-
  Hinweis; aktuelle Runtime nutzt Network+MQTT, DB-Writes aus dem
  Adapter sind unerwünscht (immer über Canonical-Apply).
- `configSchema` (JSON Schema) – die UI rendert daraus das
  Konfig-Formular.
- `defaultScheduleCron` – Default für den Scheduler, kann pro Instanz
  überschrieben werden.

Provider-Konfiguration zur Laufzeit:

```http
GET   /api/v1/integrations/providers
PATCH /api/v1/integrations/providers/:provider/config
PATCH /api/v1/integrations/settings
```

App-Settings-Schlüssel (`app_settings`):

```text
externalParkData.selectedProvider
externalParkData.selectedDestination
externalParkData.selectedPark
externalParkData.autoApplyEnabled
externalParkData.pollingEnabled
externalParkData.pollingIntervalSeconds
```

### Data Mapping

Externe Entität → kanonisches Asset:

```http
GET   /api/v1/integrations/mappings
PATCH /api/v1/integrations/mappings/:id
```

Ohne Mapping wird die Nachricht **nicht** auf interne Rides angewendet,
sondern auf `NEEDS_REVIEW` gesetzt + Issue in `data_quality_issues`. Der
Operator kann Mappings im Cockpit pflegen.

Reprocess nach Mapping-Update:

```http
POST /api/v1/integrations/canonical/messages/:id/reprocess
```

### Best Practices

- **Eine Observation pro Metrik** (oder im Adapter batchen, im Runtime
  splittet die Pipeline ohnehin pro Metrik).
- **Kein direktes DB-Write** aus dem Adapter – immer Canonical-Pfad.
- `eventTime` immer in **ISO-8601 UTC** (`...Z`).
- `assetSlug` deterministisch und stabil halten – Mappings brechen
  sonst.
- **Idempotenz**: Wenn dieselbe Observation zweimal gepollt wird,
  liefert die Pipeline identische `canonical_inbound_messages`-Rows;
  der Apply-Pfad ist idempotent über `eventTime + asset + metric`.
- Externe Quellen mit Rate Limit: in `poll()` defensiv cachen, niemals
  Backoff im Cron-Default.
- `quality` / `confidence` setzen, sobald die Quelle das hergibt – das
  Forecast-Modul nutzt sie.

### Testing (Adapter)

```bash
npm test                           # Unit-Tests, RBAC-Sync-Check
npm run test:integration           # Integration-Tests gegen DB
npm run smoke:adapters             # scanPackages + poll + encode
npm run smoke:adapter-runtime      # generischer Demo-Pfad
```

Eigene Tests legst du als `*.test.js` neben den Adapter (Unit) oder
nach `src/integration-tests/...` (DB nötig). Goldene Fixtures für
Forecast-Pipelines unter `src/services/__fixtures__/...`.

### 6 — Veröffentlichen & zertifizieren

Heute MVP-Pfad:

1. PR mit `manifest.json` + `index.js` + optional
   `README.md` / `assets/banner.svg` / `assets/logo.svg`.
2. Lokal grün:
   ```bash
   npm run lint
   npm test
   npm run smoke:adapters
   npm run governance:ci
   ```
3. Reviewer prüft `qualityTier`, `permissions`, Mapping-Strategie,
   Manifest-Konsistenz.
4. Merge → Adapter ist Teil des Repos und wird beim nächsten Deploy
   geladen.

Geplant (siehe Roadmap): Marketplace mit eigenem Versionierungs- und
Signierungs-Pfad sowie eine Adapter-Zertifizierung („CORE“, „COMMUNITY“,
„VENDOR“) in Anlehnung an `manifest.qualityTier`.

---

## Frontend Development

### UI Overview

Das Admin-Dashboard ist ein **Vue 3 + TypeScript + Vite** Projekt unter
`admin-dashboard/`. Nennenswerte Pfade:

| Pfad | Was |
|---|---|
| `src/views/` | Eine Datei pro Hauptseite (Operations, AI, MDM, UNS, …) |
| `src/components/` | Wiederverwendbare Bausteine (Cards, Boards, Forms) |
| `src/stores/` | Pinia-Stores (Auth, Park-Kontext, Realtime, …) |
| `src/composables/` | `usePageSurfaces`, `useSocket`, … |
| `src/api/` | Typisierte API-Clients (per Endpoint-Bereich) |
| `src/router/` | Routes inkl. RBAC-Guards |

Lokales Devstart:

```bash
cd admin-dashboard
npm install
npm run dev      # Vite proxyed /api + /socket.io auf 3000
```

### 4 — Frontend erweitern (eigene Karte)

Beispiel: Eine "My First Card" für die Operations-Übersicht.

1. Neue Komponente `src/components/cards/MyFirstCard.vue`:

   ```vue
   <script setup lang="ts">
   import { onMounted, ref } from 'vue';
   import { useSocket } from '@/composables/useSocket';
   import { fetchRides } from '@/api/rides';

   const rides = ref<Array<{ id: string; name: string; waitTime: number }>>([]);

   onMounted(async () => {
     rides.value = await fetchRides({ parkSlug: 'europa_park' });
   });

   useSocket('rides:waitTime:updated', (payload) => {
     const idx = rides.value.findIndex((r) => r.id === payload.rideId);
     if (idx >= 0) rides.value[idx].waitTime = payload.waitTime;
   });
   </script>

   <template>
     <section class="card">
       <h3>Top Wartezeiten</h3>
       <ul>
         <li v-for="r in rides" :key="r.id">
           {{ r.name }} — {{ r.waitTime }} min
         </li>
       </ul>
     </section>
   </template>
   ```

2. In einer View einbinden, z. B.
   `src/views/OperationsDashboard.vue`:

   ```vue
   <script setup lang="ts">
   import MyFirstCard from '@/components/cards/MyFirstCard.vue';
   </script>

   <template>
     <MyFirstCard />
   </template>
   ```

3. Permission-Guard: Wenn die Karte ein neues Recht braucht, **erst**
   in `src/constants/rbac.ts` und `src/constants/rbac.js` ergänzen,
   dann `npm run verify:rbac` lokal grün halten.

### Component SDK / Built-in Components

Wiederverwendbare Bausteine, die du fast immer brauchst:

| Komponente | Zweck |
|---|---|
| `RoleGuard` | Rendert Slot nur, wenn User die Permission hat |
| `RealtimeBadge` | Zeigt Connection-Status Socket.IO + MQTT |
| `DataTable` | Sortierbare Tabellen mit Server-Pagination |
| `MetricTile` / `KpiCard` | KPI-Kacheln für Executive-Surface |
| `ForecastBadge` | Renderfertig: Forecast-Wert + Modellversion + Horizont |
| `ParkSelector` | Setzt aktiven Park (`parkContext`-Store) |

UI-Regel: Jede Zahl, die "Forecast" heißt, **muss** Tooltip mit
Modellversion, Horizont, Zeitpunkt der Prognose und Datenquelle des Ist
zeigen (siehe `docs/Roadmap.md` §1.4).

### Data Binding (Pinia, Socket.IO)

- **REST**: typisierte Clients in `src/api/`. Sie ergänzen automatisch
  `Authorization` und `X-Park-Id`.
- **Realtime**: `src/composables/useSocket.ts` abonniert Events. Die
  vom Backend gefeuerten Events listet
  [`README.md`](README.md#socketio-events).
- **State**: Pinia-Stores für persistente Auswahl (`parkContext`,
  `auth`); ephemere Daten lokal in der Komponente.

E2E-Tests (Playwright):

```bash
cd admin-dashboard
npx playwright install
npm run test:e2e
```

---

## Platform Services

### API Reference

- OpenAPI-Spec wird gebaut: `npm run build:openapi`
- Live-Doku: `http://localhost:3000/api/v1/docs`
- Drift-Check (Routen ↔ OpenAPI): `npm run check:openapi-drift`
- Routen-Inventar: `npm run audit:routes`

Wichtige Bereiche unter `/api/v1`:

```text
zones, rides, staff, events, recommendations, dashboard
mqtt/status, integration/logs, weather, import/{staff|rides|zones}
data-quality/issues, simulator, integrations/{providers|mappings|canonical|adapters}
parks/:parkSlug/geo/flow/...    # Visitor-Flow / Process-Mining
forecasts, ml/...
```

### Webhooks & Realtime

Heute **Socket.IO** als Push-Kanal (Tabelle in [`README.md`](README.md)).
Geplant: HTTP-Webhooks (`incident.created`, `ride.down`,
`forecast.alert`) – siehe Roadmap §4.

### Authentication

- `POST /api/v1/auth/login` → Access + Refresh
- `POST /api/v1/auth/refresh`
- Token-TTL über `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_DAYS`
- Production-Pflicht: starkes `JWT_SECRET`, `CORS_ORIGIN`, HTTPS-Termination
- Roadmap: SSO (OIDC/SAML) + SCIM (siehe `PRODUCT.md`)

### File Upload / Import

`multer`-basierte Endpunkte:

```http
POST /api/v1/import/staff   (multipart: file)
POST /api/v1/import/rides   (multipart: file)
POST /api/v1/import/zones   (multipart: file)
```

Akzeptiert CSV/XLSX (`csv-parse`, `xlsx`), validiert pro Zeile, Fehler
landen als Daten-Qualitäts-Issues.

### Alerting & Daten-Qualität

```http
GET   /api/v1/data-quality/issues
PATCH /api/v1/data-quality/issues/:id
```

Realtime: `dataquality:new`, `integration:ingested`, `mqtt:status`,
`canonical:message:failed`.

---

## AI / ML

### 5 — Empfehlungen / KI anbinden

Das System schreibt **nicht** dein Modell für dich; es stellt eine
saubere Pipeline bereit. Du steckst dich an drei Stellen ein:

1. **Feature Store** lesen
   - 5-Minuten-Rollups: `park_feature_snapshots_5m`,
     `ride_feature_snapshots_5m`
   - Roh-Streams: `ride_wait_time_samples`, `weather_observations`,
     Kontext aus Adaptern
2. **Forecast schreiben** über `ForecastService` /
   `forecasts`-Tabelle (Felder: `subject_type`, `subject_id`,
   `target_metric`, `horizon_minutes`, `produced_at`,
   `model_version_id`, `features` snapshot).
3. **Recommendation erzeugen**
   ```http
   POST /api/v1/recommendations
   ```
   Beispiele aus dem Crowd-Spike-Engine: `REALLOCATE_STAFF`,
   `SEND_SECURITY`, `GUEST_ROUTING` (siehe `README.md` →
   *Crowd spike evaluation*).

Empfehlungen tauchen sofort in der Cockpit-UI auf
(`recommendations:created`, `recommendations:updated`).

### Forecast Pipeline

Normativ: [`docs/adr/0001-forecast-architecture.md`](docs/adr/0001-forecast-architecture.md).

- **Konfigurations-Schicht**: Influence-Faktoren (X → Y) – nur
  Gewichte, Lags, Scopes, **nicht** die einzige Wetter-Quelle.
- **Modell**: liefert Vorhersage + Modellversion.
- **Evaluation**: vorhergesagt vs. kanonisches Ist (Wartezeit-Priorität:
  MQTT > Wiki > intern), pro Subject und Horizont.

Tracking-Skripte:

```bash
npm run smoke:euromir-e2e
npm run smoke:wodan-e2e
npm run smoke:rides-e2e
npm run smoke:ml-influence
npm run smoke:ml-addon-board
```

### Feature Store

Tabellen-Konventionen (siehe Migrations):

- `*_feature_snapshots_5m` – append-only, kanonische 5-Minuten-Rollups
- `forecasts` – ein Eintrag pro `(subject, target_metric, horizon)`
- `forecast_evaluations` (Roadmap) – predicted vs. actual

UI-Surface: **AI Insights**, **AI Forecast Accuracy**, **AI Studio**,
**AI Feature Store Monitor** unter `admin-dashboard/src/views/`.

---

## Tools & Resources

### 3 — Live-Daten ansehen

Drei einfache Wege, die Pipeline zu beobachten:

1. **Admin-UI → Live ops**: MQTT-Status, eingehende Integration-Logs,
   Realtime-Karten.
2. **Swagger UI**:
   `GET /api/v1/integrations/canonical/messages?limit=20`.
3. **MQTT Explorer** (extern) auf `mqtt://127.0.0.1:1883`, Topics
   `tpuns/#` und `spBv1.0/#`.

### Simulator

Für Demos und Algorithmus-Tests gibt es einen **internen** Simulator
(REST + UI) und einen **Datenfluss-Seeder** für Visitor-Flow:

```http
GET  /api/v1/simulator/...
POST /api/v1/simulator/...
```

```bash
node scripts/seed-visitor-journey-events.js --park europa_park --cases 200 --days 1
```

Crowd-Spike per Curl manuell auslösen:

```bash
curl -X POST http://localhost:3000/api/v1/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "zoneId": "b1000001-0000-4000-8000-000000000002",
    "eventType": "CROWD_SPIKE",
    "crowdLevel": 8000,
    "severity": 3,
    "source": "simulator"
  }'
```

### CLI-Skripte (`npm run …`)

| Skript | Zweck |
|---|---|
| `dev` / `start` | Server (Nodemon / Node) |
| `db:migrate` / `db:seed` / `db:reset` | Schema + Demo-Daten |
| `smoke:adapter-runtime` | Adapter-Pfad |
| `smoke:adapters` | Pakete + Encoder |
| `smoke:weather-adapter` | Open-Meteo E2E |
| `smoke:euromir-e2e` / `smoke:wodan-e2e` / `smoke:rides-e2e` | Wartezeit + Forecast |
| `smoke:ml-influence` / `smoke:ml-addon-board` | ML-Gewichte / Add-on-Board |
| `seed:journey-events` | Visitor-Flow synthetisch befüllen |
| `verify:rbac` / `sync:rbac` | RBAC Frontend ↔ Backend |
| `audit:routes` | Express-Routen-Inventar |
| `validate:openapi:parse` | OpenAPI-Spec parst |
| `check:openapi-drift` | Routen ↔ OpenAPI-Drift |
| `check:route-duplicates` | Doppelte Routen |
| `build:openapi` | OpenAPI bauen |
| `governance:ci` | Alle Governance-Checks am Stück |
| `release:draft` | Release-Notes-Entwurf |

### Governance & Drift-Checks

Diese Skripte laufen in CI und sind dein bestes Frühwarnsystem:

```bash
npm run governance:ci
```

Was geprüft wird:

- OpenAPI-Drift (Routen ohne Spec / Spec ohne Routen)
- Doppelte Routen
- Root-Mount-Baseline (welche Router unter `/`)
- Adapter-Keys-Baseline (Manifeste konsistent)
- Orchestrator-Provider-Verzweigungen (keine impliziten Forks)
- OpenAPI-Build (Spec baut deterministisch)

---

## Wo geht's weiter

- **Business-Sicht**: [`PRODUCT.md`](PRODUCT.md)
- **Roadmap & Phasen**: [`docs/Roadmap.md`](docs/Roadmap.md),
  [`docs/Roadmap_BusinessCase.md`](docs/Roadmap_BusinessCase.md)
- **Adapter-Runtime im Detail**:
  [`docs/adapter-runtime.md`](docs/adapter-runtime.md)
- **Architektur-Bilder**: [`docs/architekur.md`](docs/architekur.md)
- **Source-of-Truth-Matrix**:
  [`docs/architecture/source-of-truth.md`](docs/architecture/source-of-truth.md)
- **ADRs**: [`docs/adr/`](docs/adr/)

---

*Stuck? Bevor du Custom-Code schreibst: prüfe erst, ob ein bestehender
Adapter, Service oder Composable das schon kann. Smart Park OS gewinnt
über **Wiederverwendung** der kanonischen Schichten – nicht über
parallele Pipelines.*
