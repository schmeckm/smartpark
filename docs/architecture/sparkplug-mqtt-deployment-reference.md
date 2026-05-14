# Sparkplug MQTT — Deployment-Referenz (Park · Edge · Ride)

Checkliste für **dieselbe Topic-/Identitätslogik** über Labor-Simulator, Adapter-Publisher und spätere **OPC‑UA / IT‑OT-Edge**. Keine zweite Architektur — nur konsistente IDs.

## Topic-Form (Sparkplug B, JSON-on-wire MVP)

```
spBv1.0/{group_id}/{message_type}/{edge_node_id}/{device_id}
```

| Segment | Bedeutung | Typische Quelle |
|--------|-----------|-----------------|
| `group_id` | Park-Scope auf dem Broker | `SPARKPLUG_GROUP_ID` **oder** aus Park-Slug abgeleitet (`slugify`) |
| `message_type` | z. B. `NBIRTH`, `DBIRTH`, `DDATA`, `DDEATH` | Protocol |
| `edge_node_id` | **Ein** Gateway/Edge-Prozess (OPC, Simulator, …) | `SPARKPLUG_EDGE_NODE` / Edge-Konfiguration |
| `device_id` | **Ein** Fahrgeschäft unter diesem Edge | Ride-**Slug** aus Stammdaten (muss zu Publisher passen) |

**Node-Level** (ohne Device-Segment): `NBIRTH`, `NDEATH`, … — nur `…/{edge_node_id}`.

Implementierung: `src/modules/uns/sparkplug-topic-builder.service.js` → `buildSparkplugTopic`.

## Umgebungsvariablen (Auszug aus Repo-Defaults)

| Variable | Default / Beispiel (`.env.example`) | Rolle |
|----------|--------------------------------------|--------|
| `SPARKPLUG_GROUP_ID` | *(leer)* | Wenn **leer**: viele Codepfade nutzen **`slugify(Park-Slug)`** als `groupId`. Wenn **gesetzt**: **globaler Override** — muss zum Park passen, den das Dashboard auswählt (UNS Live / SQDC filtern nach slugified Park-Key). |
| `SPARKPLUG_EDGE_NODE` | `park_gateway` | 4. Topic-Segment; **ein** Edge kann **viele** `device_id`s bedienen. |
| `MQTT_ENABLED` | `false` lokal, in `docker-compose` API oft `true` | Ohne MQTT erreicht nichts den Broker/Puffer. |
| `MQTT_BROKER_URL` | `mqtt://127.0.0.1:1883` bzw. in Compose **`mqtt://mqtt:1883`** | Container muss den **Service-Namen** nutzen, nicht `localhost`. |

### Attraktions-OEE-Simulator (Lab)

| Variable | Default (`src/config/env.js`) | Rolle |
|----------|-------------------------------|--------|
| `SIM_OEE_PARK_ID` / `SIM_PARK_ID` | `europa_park` | Wird zu Park-Slug für Routing; zusammen mit `SPARKPLUG_GROUP_ID` denken. |
| `SIM_OEE_EDGE_NODE` / `SIM_EDGE_NODE` | *(leer)* | Wenn leer: **`SPARKPLUG_EDGE_NODE`** (sonst `park_gateway`). |
| `SIM_OEE_ATTRACTIONS` / `SIM_ATTRACTIONS` | `blue_fire,silver_star` | **Nur diese** Slugs senden DDATA — jedes andere Ride im Park hat **keinen** Simulator-Traffic, bis der Slug ergänzt wird. |
| `SIM_OEE_ENABLED` / `SIM_OEE_AUTO_START` | aus | Simulator startet nur mit Feature-Flags + ggf. API/Auto-Start. |

REST (Recht `simulator:run`): `POST /api/v1/simulator/attraction-oee/start|stop|scenario`, `GET …/status`.

## Referenzzeile(n) zum Abhaken

Pro **Umgebung** (Dev / Docker / Prod) eine Zeile ausfüllen:

| Umgebung | Park-Slug (DB / UI) | `groupId` effektiv | `edgeNodeId` effektiv | Beispiel-`device_id`s (Rides) | Broker erreichbar |
|----------|---------------------|--------------------|------------------------|--------------------------------|-------------------|
| *Beispiel* | `europa_park` | `europa_park` wenn `SPARKPLUG_GROUP_ID` leer | `park_gateway` | `blue_fire`, `silver_star` | `mqtt://…` |

**Regel:** Dashboard (SQDC Live, OEE Cockpit) matched **`groupId`** + **`deviceId`** gegen **slugified** Park- bzw. Ride-Identität — nicht gegen die interne Asset-UUID allein.

## Wie viele „Knoten“ (Edges)?

- **Ein Edge pro Park** ist das Normalmodell: **viele** Sparkplug-**Devices** (Fahrgeschäfte) hängen an **einer** `edge_node_id`.
- **Mehrere Edges** nur bei Netz-Segmentierung, getrennten OPC-Servern oder bewusstem Roll-out — dann **verschiedene** `edge_node_id`s, oft **dieselbe** `group_id` (Park).

## Park-interne Overrides (optional)

Für integrationsgestützte Sparkplug-Schemata kann ein **Upload** `sparkplug.groupId` und `sparkplug.edgeNodeId` setzen (Service: `SparkplugTopicSchemaService`). Das ersetzt nicht die Pflicht, **Broker-Subscribe** und **Publisher** auf dieselben Segmente zu bringen.

## Quick-Debug

1. UNS **MQTT Live** / **Spy**: kommen `DDATA`-Zeilen mit erwarteter `groupId` und `deviceId`?
2. Simulator: ist der Ride-Slug in `SIM_OEE_ATTRACTIONS`?
3. `SPARKPLUG_GROUP_ID` gesetzt, aber Park in der UI anders? → Puffer wirkt „leer“ für diese Auswahl.

## End-to-end testen (Lab)

1. **API** `MQTT_ENABLED=true`, Broker erreichbar (lokal: `mqtt://127.0.0.1:1883`, Docker-Compose API: `mqtt://mqtt:1883`).
2. **Admin** → **Simulator**: Park im Header wählen. **Start OEE sim** nutzt Fahrten aus `SIM_OEE_ATTRACTIONS` (Default: `blue_fire`, `silver_star`) — **mit** `parkSlug` aus dem aktiven Park, damit `groupId` zu UNS/SQDC passt. Oder **Stammdaten-Fahrten** anhaken → **Start OEE sim (selected MD rides)** (u. a. ARTHUR, wenn in MD).
3. **UNS · Live MQTT** / **OEE cockpit**: Geräte unter erwartetem `groupId`; Metrik `oee_5m`.
4. **SQDC Board**: gleicher Park, gleiche Attraktion (Slug) → **OEE 5m (live)**.

Seit Backend-Anpassung: Start mit `parkId` setzt `parkSlug` aus der DB, falls nicht übergeben — Sparkplug-Gruppe entspricht dem gewählten Park.

---

*Generiert als operative Referenz; Defaults aus `src/config/env.js`, `.env.example`, `docker-compose.yml` und `sparkplug-topic-builder.service.js`.*
