Leitlinie
Zwei parallele Stränge, die sich später treffen:

Ops-Wahrheit: Incident/Case als Domänenobjekt + messbare AI (Forecast vs. Actual).
Verkaufs-Wahrheit: Park-Kontext + Audit + später SSO/Tenant – ohne das skaliert kein Enterprise-Vertrieb.

---

## Kernarchitektur: KI, Forecasting, DB & Views (Qualität der Werte)

**Ziel:** Prognosen und abgeleitete Kennzahlen (Wartezeit, Auslastung, Personalbedarf) müssen **nachvollziehbar, versioniert und gegen Ist-Werte prüfbar** sein. „Forecast influence factors (X → Y)“ sind **nur die Konfigurationsschicht** (Gewicht, Lag, Scope) – sie ersetzen **keine** hierarchische Prognose und **keinen** Feature Store.

### 1) Fachliche Hierarchie (Zielbild)

| Ebene | Typische Metriken | Bemerkung |
|--------|-------------------|-----------|
| **Park** | Gesamtlast, Tageskurve, Einlass | Aggregation, Benchmark |
| **Zone** | Crowd-Level, Fluss | bereits teilweise im System (`forecasts` ZONE / `zone_crowd_samples`) |
| **Ride / Park-Asset** | Wartezeit, Durchsatz, Downtime-Risiko | **betrieblich zentral** – Fahrgeschäft ist die Einheit für Ops + Personal |
| **Personal / Schicht** | Bedarf, Deckung | Ableitung aus Nachfrage + Constraints (Solver), nicht „ein Forecast für alles“ |

**Konsequenz:** Wetter, Ferien, Feiertage, Events wirken **als Features** (einheitlich berechnet, zeitlich aufgelöst) auf **Modelle pro Zielobjekt** (mindestens Zone + Ride/Asset), nicht nur als globale UI-Faktorenliste.

### 2) Architektur-Schichten (streng trennen)

| Schicht | Inhalt | Darf nicht… |
|---------|--------|-------------|
| **A. Konfiguration** | „X → Y“-Faktoren (Gewicht, Lag, Scope), Tenant-/Park-Defaults | …die einzige Quelle für Wetter/Ferien sein |
| **B. Feature Store** | Punkt-in-Zeit-Features: Wetter, Kalender (Ferien/Bundesland), Events, Historie, Kapazität | …ohne `valid_at` / Quelle / Version dupliziert in UI-JSON leben |
| **C. Modell / Prognose** | `forecasts` (oder Nachfolger): `subject_type`, `subject_id`, `target_metric`, `horizon_minutes`, `produced_at`, `model_version_id`, `features` (Snapshot) | …ohne Bindung an **kanonisches Ist** (Prioritätsregel Wait Time etc.) |
| **D. Evaluation** | `forecast_evaluations` o. ä.: predicted, actual, delta, Zeitraum, entity | …nur ad-hoc Queries ohne Persistenz, wenn Verkauf/Compliance verlangt |

### 3) DB-Modell (Richtung, iterativ ausbauen)

**Bereits sinnvoll / vorhanden (Ist-Tendenz):** `forecasts`, `ml_model_versions`, `zone_crowd_samples`, `ride_wait_time_samples`, Feature-Store-Ansatz in Migrationen.

**Ergänzen (Priorität):**

1. **`forecast_evaluation` (oder materialisierte Sicht)**  
   - `tenant_id` / `park_id` (später), `subject_type`, `subject_id`, `target_metric`, `horizon_minutes`, `predicted_at`, `actual_at`, `predicted_value`, `actual_value`, `error_abs`, `forecast_id` (FK optional), `ground_truth_source` (Enum: z. B. CANONICAL_WAIT, ZONE_SAMPLE, …).

2. **Feature-Versionierung**  
   - Pro Lauf: welche Feature-Version / welches Wetter-Grid / welcher Kalender-Satz wurde verwendet (`features` JSON in `forecasts` ist MVP; langfristig Referenz auf `feature_set_id`).

3. **Kanonische Ist-Wahrheit**  
   - Eine dokumentierte **Prioritätsregel** (Wiki vs. MQTT vs. intern) in Code + DB-Kommentar/ADR; Evaluation immer gegen diese Quelle.

4. **Indizes**  
   - Listen: `(subject_type, subject_id, target_metric, produced_at)`, Evaluation: `(park_id, target_metric, actual_at)` (wenn `park_id` vorhanden).

#### Zeitreihen-Layer: Wartezeit (Y) und Einflussfaktoren (X) in PostgreSQL

**Ziel:** Alles, was später für ML gebraucht wird, soll **persistiert, zeitlich geordnet und einsehbar** sein („was wurde wirklich gemessen?“). Das ist die gemeinsame Grundlage für **Exploration**, **Debugging** und **Training/Backtest** – getrennt von der reinen Konfiguration „X → Y“ in der UI.

| Strom | Typischer Inhalt | Kardinalität |
|--------|------------------|--------------|
| **Y (Ziel)** | Wartezeit (Minuten), optional Queue-Länge, Durchsatz, Downtime-Flags | **pro Fahrgeschäft** (`ride_id` / `park_asset_id`) + `ts` |
| **X (Kontext)** | Wetter (Temperatur, Niederschlag, Wind, Bewölkung), Kalender (Ferien, Feiertage, Schulferien-Profil), Events, Öffnungszeiten | **pro Park** (oder pro Wetterstation / Geo-Zelle), **nicht** 50× pro Ride duplizieren |

**Wetter/Ferien „laufen überall mit“:** Diese Größen sind **gemeinsame Kovariaten** zum Zeitpunkt `ts`. Dass ein **Indoor-Fahrgeschäft bei schlechtem Wetter** mehr Zulauf hat und eine **Wasserfahrt bei Hitze** – das ist **keine** separate Wetter-Zeitreihe pro Ride, sondern eine **Modell-/Feature-Entscheidung**: z. B. Interaktionen (`regen * is_indoor`, `temperatur * is_water_ride`) oder Ride-Typ aus dem **MDM** (`ride.category`, `indoor_outdoor`). Die Rohdaten bleiben schlank; die Unterscheidung entsteht beim Join und im Modell.

**PostgreSQL – Optionen (praxisnah):**

1. **Nur PostgreSQL (ohne Extension)**  
   - Tabellen mit `TIMESTAMPTZ`, **Partitionierung** nach Zeit (z. B. Monats-Range auf `ts`) für große Append-only Daten.  
   - Indizes: `(ride_id, ts DESC)` für Ride-Y; `(park_id, ts DESC)` für Kontext-X; optional **BRIN** auf `ts` bei sehr großen, rein zeitlich sortierten Inserts.  
   - Vorteil: keine Extra-Ops; reicht oft bis mittlere Datenmengen.

2. **[TimescaleDB](https://docs.timescale.com/) (Extension für PostgreSQL)**  
   - **Hypertables** (automatische Zeit-„Chunks“), **Retention Policies**, **Continuous Aggregates** (stündlich/täglich voraggregiert – ideal für Dashboards).  
   - Passt gut, wenn ihr **viele Messpunkte** (z. B. Minuten-/Subminuten-Granularität) und **lange Historie** pro Park wollt, ohne selbst alle Rollups zu pflegen.

3. **Separates TSDB** (InfluxDB o. Ä.)  
   - Nur sinnvoll bei sehr hoher Schreiblast oder eigenem Analytics-Cluster; sonst **zweite Quelle der Wahrheit** – für euer Stack meist später oder gar nicht.

**Pro Fahrgeschäft einsehen (Produkt/API):**

- **API:** z. B. `GET /api/v1/rides/:id/timeseries?from=&to=&include=context` — liefert Serie **Y** für genau dieses Ride und joined **X** aus Park-Kontext auf denselben Zeitstempel (oder nächster Snapshot).  
- **UI:** Explorer unter AI/Ops oder aus **Master Data → Fahrgeschäft** (Diagramm: Wartezeit + optional Wetter/Ferien als zweite Achse oder Hintergrund-Marker).  
- **Qualität:** Jede Reihe mit `source` / `ingested_at` (wie bei `ride_wait_time_samples`), damit „gemessen vs. interpoliert“ klar bleibt.

**Einordnung Phasen:** Phase 2–3: Tabellen/Partitionierung oder TimescaleDB festlegen; Kontext-X aus Wetter/Kalender **append-only** schreiben; Ride-Y weiter aus kanonischer Quelle speisen. Phase 4: Multi-Tenant-Scoping (`tenant_id`/`park_id`) auf allen Zeitreihen-Rows.

### 4) Views (Vue) – klare Verantwortung

| View / Route | Zweck | Nutzer-Erwartung |
|--------------|--------|-------------------|
| **`/ai-insights`** | Faktoren konfigurieren, External-Park-Summary, Recommendations | „Womit wird das Modell **gewichtet**?“ + operative Übersicht |
| **`/ai-insights/accuracy`** | **Messgüte** (MAE/Abdeckung) | „Stimmt das in der **Vergangenheit**?“ – Vertrauen |
| **Live Ops / Ride-Karten** (Ziel) | **Aktuelle** Prognose + Ist nebeneinander | „Was passiert **jetzt** pro Fahrgeschäft?“ |
| **Executive / Portfolio** (später) | Aggregation, Benchmark | „Park A vs. B“ |

**UI-Regel:** Jede Zahl, die „Forecast“ heißt, soll **Tooltip/Drilldown** haben: *Modellversion, Horizont, Zeitpunkt der Prognose, Datenquelle Ist*.

### 5) Qualität & Vertrauen (muss in die Roadmap)

- **Kalibrierung:** regelmäßige Auswertung MAPE/MAE pro `subject_id` + Horizont.  
- **Drift:** Alarm, wenn Fehler über Schwellen steigt (Phase 3/4).  
- **Audit:** wer Faktoren geändert hat (bereits Audit-Log-Pattern nutzen).  
- **Tests:** goldene Fixtures (kleine Zeitreihen) für Forecast-Pipeline.

### 6) Einordnung in eure Phasen

| Phase | KI-Bezug |
|-------|----------|
| **Phase 2 (Erweiterung)** | `forecast_evaluations` persistieren; Ride/Wartezeit-Kanal; Accuracy UI um **Top Rides** erweitern. |
| **Phase 3** | Feature-Store-API (read-only) für Wetter/Kalender; Faktoren nur noch Referenz auf Feature-Codes. |
| **Phase 4** | Multi-Tenant-Scoping aller Forecast-/Evaluation-Rows; SSO; ggf. separates Analytics-Schema/TSDB. |

---

Phase 0 (1–2 Wochen): Fundament für alles Folgende
Schritt	Umsetzung
Park-Kontext
Router + API: jede relevante Liste/Mutation mit parkId (oder aktiver Park aus Session); Backend prüft, dass der User Zugriff auf genau diesen Park hat.
RBAC erweitern
Neue Permissions: `ops.read`, `incidents.read`, `incidents.create`, `incidents.assign` (siehe Phase 1).
Design-Basis
Composable `usePageSurfaces` für Ops-Views (Light/Dark, konsistent mit Settings).
Erfolg (Ist Phase 0): Park-Selector + `X-Park-Id` + Backend-Validierung; harte User↔Park-Zuordnung (`user_parks` / Tenant) bewusst später.

Phase 1 (Wochen 2–6): Operational Case (Incident MVP) – CEO-Priorität
Backend (Node/Sequelize):

Tabellen z. B.: incidents (id, park_id, status, severity, title, description, owner_user_id, linked_entity_type, linked_entity_id, sla_due_at, created_at, …), optional incident_events oder JSON-Audit über bestehendes Audit-Log.
REST: POST/GET/PATCH /api/v1/.../incidents, Filter nach Status/Park, Zuweisung.
Optional: Webhook-Stub oder internes Event incident.created (für später).
Frontend (Vue):

Route Ops → Incidents (Liste + Detail + Formular).
Mobile-freundliche Liste (Quick Win aus Roadmap).
Erfolg: Fall anlegen, zuweisen, schließen, verknüpfen (Ride/Zone), Audit sichtbar; ein Management-Export oder einfache „Top offene Fälle“-Ansicht.

**Phase 1 – MVP umgesetzt (Code):** Migration `incidents`, API `GET/POST/PATCH /api/v1/incidents` (Header `X-Park-Id` Pflicht), Audit `incident.create` / `incident.update`, Vue-Routen `/incidents`, `/incidents/new`, `/incidents/:id`, Menüeintrag; Formulare mit **optionaler Verknüpfung** (`linkedEntityType` / `linkedEntityId`). Noch offen: Export, Webhooks, `incident_events`-Tabelle, MDM-Validierung der Links.

Phase 2 (parallel Woche 3–8): Forecast vs. Actual
Backend:

Batch oder Stream: pro Ride/Park Prognose (bestehend) + Ist (Wartezeit aus eurer kanonischen Quelle mit Prioritätsregel).
Tabelle oder Materialized View: forecast_evaluations (entity_id, horizon, predicted, actual, ts) – minimal, aber query-fähig.
Endpoint: Aggregation letzte 7 Tage (MAPE/MAE grob).
Frontend:

Eine Seite AI → Accuracy (oder unter Live Ops): Chart + Tabelle Top-N Rides.
Erfolg: Ihr könnt in einer Demo sagen: „Hier ist der Fehler unseres Modells“ – das ist Vertrauen und Upsell für AI Premium.

**Phase 2 – MVP (Ist):** `GET /api/v1/ai/forecast-accuracy/zone-crowd` vergleicht `forecasts` (ZONE, CROWD_LEVEL) mit `zone_crowd_samples` um den Zielzeitpunkt (producedAt + Horizont); liefert MAE gesamt und pro Zone. UI: `/ai-insights/accuracy`, Link von AI Insights. Noch offen: Ride/Wartezeit-Kanal, persistierte `forecast_evaluations`, Charts.

Phase 3 (Wochen 6–10): Quick Wins aus der Roadmap, die Phase 1/2 verstärken
Downtime Reason Codes (Enum + FK auf Incident oder Ride-Status-Event).
Alarm-Routing MVP in Settings (In-App, Schwellen, Ruhezeiten) – speichern in DB, Auswertung beim Erzeugen von Incidents/Toasts.
API Keys (Hash im DB, Scope, Rotation) für interne Skripte – Vorbereitung Webhooks.
Phase 4 (Monat 3+): Midterm – nur wenn Phase 1–2 stabil
Reihenfolge sinnvoll:

Work Orders aus UNS/Alarm → verknüpft mit incident_id.
Webhooks (Incident, Ride down, Forecast alert).
SSO-ready: organizations + OIDC-Config pro Org (Passport/openid-client), lokale User als Fallback.
Multi-Tenant: tenant_id auf User/Park/Incidents + Middleware – nach SSO-Design, sonst doppelte Migration.
Organisation / Rollen im Team
1 Product Owner: Definition „Incident done“, SLA-Felder, erste Reports.
Backend: Schema + API + Tests + Audit.
Frontend: Incidents + Accuracy + Park-Switcher.
Wöchentlich: eine Demo-Schiene (gleicher Park, gleiche Daten) – verkaufbarer roter Faden.
Kurz: Was ihr morgen konkret startet
ADR/Spec (1–2 Seiten): Incident-Lebenszyklus + Felder + wer welche Permission hat.
Migration incidents + API + minimale Vue-Liste/Detail.
Parallel: Datenabfrage Forecast vs. Actual (auch wenn die erste Version nur CSV/Admin-Query ist).
Wenn du willst, kann als Nächstes eine Implementierungs-Section direkt in Roadmap_BusinessCase.md (Epics, Meilensteine, Abnahmekriterien) ergänzt werden – sag Bescheid, dann schreibe ich den Abschnitt in die Datei.