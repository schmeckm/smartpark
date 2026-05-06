Die Analyse basiert auf Repo-Struktur (admin-dashboard/src/router/index.ts, admin-dashboard/src/layouts/MainLayout.vue, src/models/index.js, src/constants/rbac.js, admin-dashboard/src/constants/rbac.ts, Migrationen unter src/migrations/, Doku docs/Adapter.themeparks.wiki.md) und typischen Mustern einer gewachsenen Monolith-API + SPA.

1. Codebase Review (kompromisslos)
Doppelte / divergierende „Wahrheiten“

RBAC zweimal gepflegt: src/constants/rbac.js (API) und admin-dashboard/src/constants/rbac.ts (UI) — gleiche Rollen/Keys, kein gemeinsames Package. Änderung an einer Seite = stiller Security-Bug auf der anderen.
„Ride“-Konzept mehrfach: klassisches rides/zones/staff (Wave-1), MDM (mdm.models), Platform (park_assets, asset_observations, …). Gleiche fachliche Entität, mehrere Speicher — Mapping-Fehler sind vorprogrammiert.
User-Profil: auth/me vs users/me/settings — vertretbar, aber ohne klare API-Doku wirkt es wie doppelte Einstiegspunkte.
Tote / redundante Routen

In admin-dashboard/src/router/index.ts: Redirects wie integrations/adapters → Devices & Services, park-entities → Integrations — Altlasten, nicht „tot“, aber navigations- und SEO-unsauber.
Catch-all /:pathMatch(.*)* → / verschluckt 404; für Enterprise unüblich (kein Audit-Trail „User hat falschen Link“).
Ordnerstruktur / Naming

Backend: sinnvolle Trennung modules/, services/, aber Adapter-Logik verteilt auf modules/adapters/themeparks/, services/adapter-*.js, integrations/adapters/ — ohne strikte „Boundary“-Regel.
Frontend: views/, views/settings/, views/master-data/, views/mdm/, views/platform/ — vier Begriffe für „Stammdaten“ (master-data, mdm, platform). Das ist kein Naming-Problem, es ist ein Produkt-Identitätsproblem.
Zu große Komponenten / fehlende Reuse

MasterDataEntityView.vue (sehr groß) — God-View: Tabellen, Wizard, API, Export, UNS — muss in Sub-Views + composables zerschnitten werden.
IntegrationSettingsView.vue, UnsLiveStateView.vue, AdapterPipelineLogView.vue — ähnlich: wenig wiederverwendbare Table-/Filter-/Status-Cards.
Fehlend: ein DataTable-Pattern (Sortierung, Pagination, Empty, Loading), ein PageHeader-Slot-Layout.
Konkrete Cleanup-Liste (Auszug)

Priorität	Aktion
P0
RBAC in ein shared Modul (z. B. packages/rbac/) oder Build-Schritt, der JSON aus einer Quelle generiert; CI-Test: Keys API === UI.
P0
Fachliche Klarheit: eine „Ride identity“-Quelle dokumentieren (Platform park_assets vs MDM vs legacy rides) + Deprecation-Pfad.
P1
MasterDataEntityView.vue in 4–6 Routen/Child-Routes oder lazy Subpanels splitten.
P1
Navigations-Begriffe vereinheitlichen (siehe UX unten); Redirect-Routen nach Migration entfernen oder 410-Docs.
P2
Catch-all: echten 404 mit Log statt Redirect auf /.
P2
Doppelte Health-/Status-Logik (Adapter-Pakete vs Pipeline-Log) auf eine Status-Domain konsolidieren.
2. Database Review
Was da ist (Auszug aus src/models/index.js + Migrationen)

Legacy: zones, rides, staff, crowd_events, recommendations, …
Integration/AI: canonical_inbound_messages, ride_wait_time_samples, *_feature_snapshots, forecasts, …
Platform: parks, park_assets, park_zones, asset_observations, Templates, …
UNS: uns_nodes, uns_devices, uns_latest_states, …
User: users, user_roles (Rollen nicht mehr nur Enum auf users.role — Migrationspfad zeigt Hybrid)
Redundanzen / Risiken

Wartezeit / Status: ride_wait_time_samples + Canonical + teils asset_observations — fachlich überlappend; ohne dokumentierte „System of record“ pro Use-Case driftet Historie.
Ride: rides vs MdmRide* vs ParkAsset — drei Welten; Foreign Keys über UUIDs und external_entity_id — fehleranfällig bei Import/Re-Sync.
Snake_case: DB konsistent underscored; Models gemischt camelCase + field: — ok für Sequelize, aber API-Response-Naming muss strikt einheitlich sein (camelCase + ISO UTC).
Fehlende / schwache Enterprise-DB-Themen

Viele Tabellen ohne deleted_at / Soft-Delete (nur wo explizit vorgesehen).
created_by / updated_by auf Stammdaten-Änderungen oft nicht durchgängig (Audit-Log fängt nur „kritische“ Events, nicht jede Row).
Partitionierung großer Append-Only-Tabellen (canonical_inbound_messages, asset_observations, integration_event_logs) — für 100 Parks ohne Konzept riskant.
Indizes: Teilweise gut (z. B. asset_observations laut Migration); Canonical/Events brauchen Query-Pfad-getriebene Composite-Indizes (park + time + type).
Zielmodell (Kurzfassung)

Operational truth pro Metrik: z. B. Wartezeit = eine append-only Fact-Tabelle + materialisierte „current“-View oder Feature-Store-Job — nicht drei parallele Pfade ohne Regel.
Identity: park_assets (oder MDM) als einzige interne Asset-ID; Legacy-Tabellen nur noch Views oder strikte FKs darauf.
Governance: Soft-Delete + updated_by + optional Row-Level Security später (Postgres).
Scale: Partitionierung nach park_id + month für große Logs/Observations.
Tabellen „löschen“ (E) — ohne Live-DB-Analyse keine Liste „wegschmeißen“. Im Repo gibt es keine offensichtliche „nur Demo“-Tabelle ohne Model-Verwendung; Löschen wäre fahrlässig. Stattdessen: Deprecation-Register + „read-only legacy“ markieren (rides wenn vollständig durch Platform ersetzt).

3. Adapter Architecture Review
Bekannt aus Code/Doku (docs/Adapter.themeparks.wiki.md, canonicalToSparkplugPublisher, asset-mqtt.publisher.js, adapter-installed-scheduler.service.js):

Was fehlt für Enterprise

Thema	Status (ehrlich)
Outbox + Retry
MQTT teils direkt; Doku nennt Risiko „kein persistenter Retry“ — kein Enterprise-Grade.
DLQ / Dead letter
Fehlt als first-class (failed canonical, failed publish).
Health
Punktuell (HTTP health zu Provider); kein SLO-Health pro Adapter-Version über Zeit.
Metrics
Kein Prometheus/OpenTelemetry-Standard im Review-Umfang sichtbar.
Adapter Registry
adapter_packages + YAML — gut als Anfang; kein zentraler „Contract“-Test (Schema der Canonical-Payloads pro Version).
Observability
Logs ja; Trace-ID von HTTP → Canonical → DB → MQTT durchgängig? Selten sauber.
Zielbild: Ingest → persist message → Outbox → Worker publish → Status-Tabelle; DLQ für unparseable Payloads; Metriken adapter_runs_total, publish_failures, lag_seconds.

4. Frontend UX Review
Navigation (MainLayout.vue)

Sektionen PARK & ASSETS, OPERATIONS, INTEGRATIONS, GOVERNANCE, PERSONAL — grundsätzlich richtig.
Problem: „Master data“ hängt an rides.read; Platform-Hub und MDM-Rides wirken für Nutzer wie drei Stammdaten-Welten (/admin/master-data, /mdm/rides, /platform/...).
Live connectivity: Nutzer mit nur integration.read aber ohne dashboard.read bekommt denselben Label-Key wie Live Ops — Hack in navSections (Zeilen ~139–143) — amateurhaft lesbar.
Dark Theme / Mobile

Shell ist ok; viele Seiten noch Monolith-<pre> und breite Tabellen — nicht mobil-first.
Leere Flächen / KPI: uneinheitlich; kein gemeinsames KPI-Grid.
Bessere Menüstruktur (Vorschlag)

Operations — Live Ops, Incidents, Staff, Simulator
Intelligence — AI Insights (+ Unterpunkte Accuracy, Timeseries, Ride grid)
Data — ein Eintrag „Master data“ mit Untermenü: Parks, Assets, Templates, Import/Export, Data quality
Integrations — Connections, Devices & Services, Adapter Ops, UNS
Admin — Users/Roles (wenn Route existiert), Audit, Settings
(MDM vs Platform: im Menü nicht zwei parallele Bäume ohne Erklärung.)

5. Security Review
JWT + Refresh: üblich; authenticate lädt User + userRoles — gut.
RBAC-Duplikat (s. oben): hohes Risiko.
Self-protection: Kein Review ohne gezielte Suche nach „User darf sich selbst ADMIN geben“ — muss explizit geprüft werden (User-Controller aktuell nur Settings).
Park context: X-Park-Id / Middleware — gut für Multi-Park; Tenant-Isolation auf allen Queries muss auditsicher sein (ein vergessener where park_id = Datenleck).
Secrets: nur .env/Compose — ok für Self-hosted; für SaaS: Secrets Manager, Key Rotation.
Audit: audit_logs existiert; Abdeckung ungleichmäßig (nicht jede sensiblen Änderung).
6. Settings / i18n Review
i18n: en/de/fr/es — gut.
Regional: kürzlich ergänzt (Timezone, Formate) — richtige Richtung.
White-label: app_setting im Model-Index — ohne durchgängige UI/API bleibt es Potenzial, kein Produktfeature.
Inkonsistenz: viele Views noch harte englische Strings (z. B. Teile von Live/UNS) — wirkt nicht „enterprise polished“.
7. ML Readiness Review
Vorhanden: Wartezeit-Samples, Feature-Snapshots, Forecasts, Scores, Kalender-Kontext, Wetter — Basis für Queue/Last-Prognosen.

Fehlt für ernsthafte Use-Cases

Use-Case	Fehlendes
Staffing optimization
Geplante vs tatsächliche Schichten pro Zone/Ride, Skill-Matrix, Öffnungszeiten pro Mitarbeiter, Demand-Signale aggregiert.
Revenue forecast
POS/Tickets, Preise, Kapazität, Conversion — kein Revenue-Fact-Modell im Scope.
Breakdown / Downtime
Strukturierte Incident ↔ Asset ↔ Downtime-Minuten-Facts (nicht nur Text-Incident).
Dynamic routing
Echtzeit-Constraints (Wegnetz, Kapazität pro Segment) — über klassische Park-Metriken hinaus.
Fazit: Datenmodell ist MVP-tauglich für Wartezeit/Last; nicht investor-ready für vollständiges „Operations Research“-Produkt.

8. Performance Review
1 Park: typischer Postgres + eine API-Instanz — ok.
10 Parks: Engpass = Canonical/Observation-Write-Rate + MQTT-Fan-out + fehlende Partitionierung.
100 Parks: ohne Sharding / read replicas / queue-basierte Ingest + strikte Park-Scoped-Indizes — single API-Node wird zum Scherz.
Bottlenecks (typisch)

Große findAll mit limit 5000 in Feature-Pipelines.
WebSocket + REST ohne Rate-Limits pro Tenant.
Schwere Views (MasterDataEntityView) = Client-Performance, nicht nur Server.
9. Brutal Honest Product Review (Investor)
Warum kaufen?
Solide Integrations- und Normalisierungs-Schicht (Canonical, Adapter, MQTT/UNS), brauchbar für einen großen Kunden oder interne Ops-Plattform.

Warum nicht?
Kein klares Multi-Tenant-SaaS (Billing, Mandantenfähigkeit, SLA, Self-Service Onboarding), kein einheitliches Daten- und Navigationsmodell, RBAC dupliziert, ML/Analytics noch Demonstrator, nicht „decision platform“.

Amateurhaft: Doppel-RBAC, drei Stammdaten-Welten, riesige Vue-Dateien, Redirect-Sammelsurium, teils rohe JSON-<pre>-„Debug-UI“ als Nutzerfläche.

Enterprise-wirkend: Durchgängige Auth, Audit-Log-Idee, Modularisierung im Backend, Adapter-Framework-Ansatz, i18n + Regional Settings.

10. Output (A–J)
A. Top 25 Verbesserungen (gekürzt, prioritär)
RBAC Single Source of Truth + CI-Abgleich.
Identitätsmodell: eine Asset-/Ride-Wahrheit + Migrationsplan von Legacy.
MQTT/Canonical: Outbox + Retry + Publish-Status.
DLQ für fehlgeschlagene Messages/Publishes.
OpenAPI als Contract; Client-Typen daraus generieren.
MasterDataEntityView.vue zerlegen.
Nav „Data“ konsolidieren (MDM/Platform/Master).
404 statt Catch-all → /.
Partitionierungs-Strategie für Logs/Observations.
Observability: Trace-ID + strukturierte Logs.
Prometheus-Metriken Adapter + API.
Row-level „wer hat geändert“ auf kritischen Tabellen.
Soft-Delete-Standard für Stammdaten.
API: durchgängig camelCase + ISO UTC prüfen (keine lokalen Strings).
Security-Audit: alle park_id-Filter in Repositories.
User-Management-UI + Self-Service-Rollen (falls fehlend).
White-label Settings API + UI.
E2E-Tests für Login + kritische RBAC-Pfade.
Rate limiting / Abuse-Schutz öffentlicher Endpunkte.
Adapter-Contract-Tests (Payload-Schema pro Version).
Einheitliche Table-Komponente.
Mobile: kritische Ops-Views responsive machen oder „Desktop only“ explizit.
Dokumentation: Data lineage End-to-End (ThemeParks → Canonical → DB → MQTT).
Deprecation-Register für Redirects und Legacy-Tabellen.
Kostenmodell 100 Parks (Infra-Sizing-Dokument).
B. Top 10 Quick Wins (7 Tage)
RBAC-JSON aus einer Datei generieren (Script + CI).
Catch-all → 404-View.
Nav-Labels: MDM/Platform/Master umbenennen + Tooltips.
IntegrationSettingsView / Wave2LiveView: härteste <pre> durch formatierte Summary-Cards ersetzen.
Audit: eine Standard-Policy „was wird geloggt“.
README: „System of record“ pro Metrik (1 Seite).
DB: fehlende Indizes auf häufigsten List-Queries (Canonical nach park+time).
API: users/me Response-Doku inkl. regional fields.
Frontend: eine formatDateTime-Policy überall (Rest grep).
Security: Suche nach fehlendem parkId in neuen Routen.
C. Top 10 Midterm (30 Tage)
Outbox für MQTT.
Master-Data-View split.
Adapter Health Dashboard (Zeitreihe Fehlerrate).
DLQ + Reprocess-UI.
OpenAPI + generierter TS-Client.
Partitionierung größter Tabellen.
User/Role Admin UI komplett.
Soft-Delete + updated_by Kern-Tabellen.
E2E (Playwright) Smoke.
Performance-Budget: p95 API pro Route.
D. Top 10 Strategic (90 Tage)
True multi-tenant (org_id, Billing hooks).
Identity-Konsolidierung Legacy/Platform/MDM.
Data warehouse-Export (Snowflake/BigQuery) oder star schema.
ML Feature Store produktiv (Scheduling, Qualität, Monitoring).
SRE: SLIs/SLOs, On-Call Runbooks.
Secrets Manager + Rotation.
Fine-grained permissions (Ressource pro Park).
Mobile Ops App oder PWA.
Marketplace/Adapter-Lifecycle (Zertifizierung).
Compliance (GDPR DPA, Log retention).
E. Tabellen die gelöscht werden können
Keine ohne Datenanalyse empfehlen. Im Code sind alle genannten Modelle verkabelt. Stattdessen: Deprecation + „0 rows seit X Monaten“-Report.

F. Komponenten die refactored werden müssen
admin-dashboard/src/views/master-data/MasterDataEntityView.vue
admin-dashboard/src/views/IntegrationSettingsView.vue
admin-dashboard/src/views/uns/UnsLiveStateView.vue
admin-dashboard/src/views/settings/AdapterPipelineLogView.vue
admin-dashboard/src/layouts/MainLayout.vue (Nav-Konfiguration in JSON/Modul auslagern)
G. UX Score 1–10: 5/10
(Funktional, aber uneinheitlich, zu technisch, schwache Information Architecture.)

H. Architecture Score 1–10: 6/10
(Solide Module, aber Duplikate, gewachsene Daten-Doppelpfade, fehlende Enterprise-Infrastruktur-Muster.)

I. SaaS Potential Score 1–10: 5/10
(Stark als Integrations-/Ops-Plattform für wenige große Deployments; schwach als self-serve Multi-Tenant SaaS ohne weitere Arbeit.)

J. Wenn ich CTO wäre — morgen zuerst
RBAC vereinheitlichen und in CI absichern (src/constants/rbac.js + admin-dashboard/src/constants/rbac.ts → eine Quelle). Alles andere (Outbox, UI) baut darauf auf; ein falscher Permission-String ist teurer als jede neue KPI-Karte.

Zielbild Enterprise-Plattform (ein Satz):
Eine Mandanten-fähige Event- und Asset-Wahrheit (Identity + Zeitachse), verlässlicher Integrations-Transport (Outbox, DLQ, Metriken), eine Berechtigungs- und Navigationslogik, und eine UI, die Entscheidungen aggregiert — nicht Roh-JSON für Power-User als Default.