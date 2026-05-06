1. Executive Summary
Smart Park OS ist keine „Idee“, sondern bereits eine ernsthafte technische Plattform-Skelettierung: relationales MDM, Integrations-/Adapter-Denken, UNS/Sparkplug/MQTT, Forecasting/Recommendations, Simulator, Audit-Spur. Das ist über dem Niveau typischer Park-Software-Demos.

Der Abstand zu marktführender Enterprise-Plattform liegt nicht primär an „noch mehr Screens“, sondern an vier Lücken:

Betriebs-Workflow & Verantwortlichkeit (Incident → Eskalation → Nacharbeit → Reporting) als erstklassiges Objekt, nicht als UI-Anhängsel.
Wirtschaftliche & personelle Wahrheit (Kosten, Verträge, Skills, Compliance, Schichten) – ohne das bleibt „AI Staffing“ ein Chart.
Mandantenfähigkeit & Trust (Multi-Park, Datenisolation, SSO/SCIM, Retention, DPA, Observability) – ohne das kein Konzern-SaaS.
Beweisbare Outcomes (SLA, Forecast-Fehler, Laborstunden gespart, Queue-Minuten vermieden) – ohne das kein CFO-Deal.
Brutal ehrlich: Ihr seid näher an „Palantir für Parks“ (Daten + Graph + Ops) als an „Disney Genie + Workforce + ERP“. Das ist gut, wenn ihr es bewusst positioniert und die fehlenden Enterprise-Schichten systematisch nachzieht.

2. Top 25 fehlende Features (Impact ↓, grob: Aufwand)
#	Feature	Warum es zählt
1
Incident / Case Management (Severity, Owner, SLA, Root Cause, Attachments, Post-Mortem)
Ops ohne Case-Objekt skaliert nicht.
2
Shift Handover & Tagesjournal (signiert, revisionssicher)
Rechtliche/organisatorische Realität.
3
Mobile Field App (Offline-first für Technik/Sicherheit)
Bodenpersonal nutzt kein Desktop-Dashboard.
4
Dispatch / Tasking (Work Orders aus Events)
Verbindet IoT/UNS mit Menschen.
5
Wartung CMMS-light (Asset-BOM, Wartungspläne, Downtime-Codes)
Rides + Downtime sind Kern-P&L.
6
Skills + Zertifikate + Ablauf
Ohne das ist Staffing „Pins auf Karte“.
7
Echtzeit-Kollaboration (Chat/Threads pro Incident/Asset)
Reduziert Funk-Chaos.
8
Heatmaps / Crowd Routing (Zonenlast, Wege, Engpässe)
Direkter Gäste- und Sicherheitswert.
9
Forecast Accuracy Tracking (MAPE pro Attraktion/Horizont)
Macht AI verkaufbar.
10
Experimente / A-B für Empfehlungen
Sonst ist AI „Oracle ohne Rechenschaft“.
11
Data Contracts + Quality SLAs (Freshness, Completeness)
Enterprise-Datenvertrauen.
12
Historian / Zeitreihen-Store (separat von OLTP)
Skalierung + Digital Twin.
13
OPC UA / Edge-Normalisierung (neben MQTT)
Industrie-Realität außerhalb „MQTT-first“-Parks.
14
SSO (OIDC/SAML) + SCIM
Gatekeeper für Enterprise.
15
Mandanten-Modell (Org → Park → Site) + Row-Level Security
Multi-Park/Franchise.
16
API Keys / Webhooks / Partner Sandbox
Ökosystem & Integration Revenue.
17
Billing/Metering (Streams, Seats, Parks, AI calls)
SaaS ohne Metering ist Hobby.
18
White-Label + Policy Pack (Branding, Retention, Region)
Konzern-Einkauf.
19
Executive Command Center (3–5 KPIs, Drilldown, Benchmark)
C-Level kauft anders als Ops.
20
Labor Productivity (Std/Gast, Std/Umsatzzone, Überstunden)
CFO-Narrativ.
21
Revenue / P&L Views (auch wenn Daten teilweise importiert)
Management-Surface.
22
Vendor Access (zeitlich begrenzt, auditiert)
Lieferanten-Ökosystem.
23
Simulation → Plan (Was-wäre-wenn → freigegebener Plan)
Brücke Simulator ↔ Realität.
24
Policy-gesteuerte Alarme (Routing, Quiet Hours, Eskalation)
Alarm UX ohne Burnout.
25
Digital Twin „Graph“ (Asset-Zustand + Mensch + Aufgabe + Event)
Differenzierung vs. reine BI-Tools.
3. Top 10 Quick Wins (~30 Tage)
Hoher Nutzen, überschaubarer Aufwand, stärkt Verkauf/Demo.

Incident MVP (Tabelle + UI + Audit): anlegen, Status, Owner, Ride/Zone-Link, Notizen.
Forecast vs. Actual Dashboard (auch simpel): letzte 7 Tage pro Park/Top-Rides.
Alarm-Routing in Settings: Kanal (In-App), Schwelle, Stille-Zeiten (MVP).
SSO-ready Architektur: OIDC-Provider pro Tenant (auch wenn nur 1 IdP zuerst).
Park-Kontext überall erzwingen (URL + Server-Guard): weniger Datenlecks, klarere UX.
Executive „Single Page“ (5 KPIs, keine Navigation-Tiefe).
Mobile-responsive Ops-Listen (Queues, Incidents) – nicht „alles mobil“, aber lesbar.
Downtime Reason Codes (kleines Enum + Reporting).
API Keys (scoped, rotierbar) für interne Automatisierung.
Design Tokens / Light-Dark konsistent (ihr habt angefangen – flächendeckend für Ops-Screens).
4. Top 10 Midterm (~90 Tage)
SCIM + Gruppen-Mapping zu Rollen.
Work Orders aus UNS/Alarm (Dispatch).
Skills Matrix + Ablaufdatum + harte Constraints im Staffing.
Zeitreihen-Pipeline (OLTP → Warehouse/TSDB) + erste „Historian“-APIs.
Multi-Park Roll-up (Portfolio) + delegierte Admin-Rollen.
Webhook-Events (Incident created, ride down, forecast alert).
Experiment-Framework für AI-Empfehlungen (Holdout, Logging).
Heatmap MVP (Zonenaggregation aus vorhandenen Events).
SLA-Monitor (Datenfreshness, Adapter-Latenz, MQTT-Lücken).
Partner/Vendor Rollen + zeitlich begrenzte Zugänge.
5. Top 10 Game Changer (12 Monate)
Closed-loop Operations: Event → Case → Task → Asset → Post-Mortem → Playbook.
Eingebetteter Optimizer (MIP/CP-SAT) für Schichten + Zonenbedarf unter Constraints.
Edge + UNS + Twin Graph als verkaufsfähiges „Reference Architecture“-Paket.
Industry Benchmark Datenpool (anonymisiert, opt-in) – Netzwerkeffekt.
CFO Suite: Labor, Queue-Pain, Utilization, Forecast Accuracy in einem Narrativ.
RL/Policy Learning nur nach sauberem Logging & Simulation – sonst Science-Fiction.
OPC UA / heterogene Parks – Marktbreite.
Compliance-Paket (ISO27001-Pfad, DPA-Vorlagen, Retention).
Marketplace (Adapter, Wetter, Ticketing-Connectoren) mit Revenue Share.
„Park Digital Twin“ SDK für Systemintegratoren.
6. DB-Architektur – Verbesserungen (prinzipiell, priorisiert)
Stärken (Ist-Tendenz aus Migrations/Namen): Zonen, Rides, Staff, Crowd Events, Recommendations, UNS-Governance, Forecast-Feature-Store – das ist kein Spielzeug-Schema.

Typische Enterprise-Lücken:

organizations / tenants explizit; alle geschäftskritischen Tabellen darauf normalisiert (nicht nur park_id).
Temporal Tables / valid_from–valid_to für Master Data, die sich oft ändern (Kapazität, Öffnungszeiten, Templates).
event_outbox + idempotency_keys für Integrations-Pipeline (Ihr habt Adapter-Logs – nächster Schritt ist exactly-once Semantik fachlich zu definieren).
Zeitreihen auslagern (Timescale/ClickHouse/BigQuery): observations wachsen exponentiell.
„Golden Asset“ vs. Provider-Entity strikt trennen (Ihr seid auf gutem Weg mit MDM/Canonical – formalisiert Provenance pro Feld).
Index-Strategie: alle Listen-APIs nach (tenant_id, park_id, updated_at) und häufige Join-Pfade; FTS nur wo nötig.
Staffing: separate Plan (Soll) vs. Actual (Ist) vs. Forecast (Modell) – sonst mischt ihr Entscheidungsspuren.
Redundanz: Vermeidet doppelte „Wahrheit“ für Wartezeit (Wiki vs. MQTT vs. intern) ohne Prioritätsregel in der DB/Schicht.

7. ML-Roadmap
MVP (wirklich verkaufbar):
Baselines + saisonale Regressoren (z. B. Prophet/XGBoost auf aggregierten Features) + kalibrierte Unsicherheit + Accuracy-Tracking. Erklärbarkeit > LSTM-Glamour.

Advanced:
Hierarchische Zeitreihen (Park → Zone → Ride), Graph-Features (Crowd-Flow zwischen Zonen), Constrained Optimization für Personal (Solver > neuronale Netze für Scheduling).

RL: Nur sinnvoll mit Simulator als sichere Umgebung + strikten Guardrails – sonst Haftung/Operatoren-Vertrauen = 0.

Datenlücken typisch: Ticketing/Events, Preise/Promos, echte Kapazitätslimits, Ride-Reliability, Wetter-Granularität, Personal-Ist-Zeiten, Gästezufluss pro Eingang.

8. UX-Redesign-Vorschlag
Navigation: Zwei Ebenen max. im Alltag: „Heute“ (Ops) und „Planen“ (Workforce/AI); „Plattform“ (MDM/UNS/Integration) für Admins auslagern.

Operator: Hoher Informationsdichte, kein „Marketing-Gradient“; Fokus auf Alarm-Inbox, Karten/Listen-Split, Tastaturkürzel, Lesbarkeit bei Sonne (Outdoor).

Executive: 3 KPIs + Trend + Ausnahmen; alles andere Drilldown.

Farben: Weniger „Consumer SaaS“, mehr SAP Fiori / Linear / Vercel: neutrale Flächen, eine Akzentfarbe, strenge Kontrast-Regeln (WCAG AA Minimum), Light-Mode als gleichwertig (nicht Dark mit weißen Resten).

Fehlende Patterns: Command Palette, Saved Views, Annotations auf Zeitreihen, Incident Timeline, Role-based default landing.

9. Rollenmodell Enterprise
Rollen (Beispiele):
Platform Superadmin · Org Admin · Park GM · Ops Director · Ride Supervisor · Safety/Security · Maintenance Lead · Workforce Planner · Analyst (read-only + export) · Finance Controller (scoped) · Vendor Support (time-boxed) · Integration Engineer.

Permission Matrix:
Ressource × Aktion × Scope (Org/Park/Zone/Asset) × Umgebung (Prod/Staging) × Datenklassifikation (PII/Operational).

Multi-Tenant:
tenant_id überall + Policy Enforcement in einer Schicht (nicht nur im Router).
Franchise: Org-Hierarchie, delegierte Policies, geteilte Templates, getrennte Datenräume optional „Shared Catalog“.

SSO: Pflicht für Enterprise; lokale User nur Break-Glass.

10. SaaS Business Model
Pakete (Vorschlag):

Tier	Kern	Monetarisierung
Basic
MDM + Live-Dashboards + Audit
Pro Park / capped assets
Pro
Integrations + UNS Explorer + Webhooks + SSO
Pro Park + Integrations-Runs
Enterprise
Multi-Park, SCIM, SLA, dediziertes Deployment-Option
Jahresvertrag + PS
AI Premium
Forecast + Recommendations + Optimizer + Accuracy SLA
Metered (Predictions, Optimizer-Runs) oder % der eingesparten Std (nur mit Nachweis)
Upsells: Historian-Speicher, zusätzliche Edge-Gateways, Benchmark-Pool, White-Label, Premium-Support, Professional Services (Integratoren).

11. Brutale Scores (1–10) heute, relativ „Enterprise marktführend“
Dimension	Score	Kurzbegründung
Product
6.5
Breite da, Tiefe in Workflow/Commercial/Governance noch nicht.
Tech
7.0
Solider Stack, echte Integrations-/Datenpfade; SaaS-Härtung fehlt.
UX
5.5
Funktional, aber nicht „Executive/Ops-first“ konsistent.
Market Potential
8.0
Markt ist fragmentiert, Pain ist real – Distribution ist der Engpass.
AI Readiness
6.0
Daten-Pipeline/Feature-Store-Ansatz gut; Messbarkeit & Governance fehlen.
Scalability
6.0
Skaliert für Piloten; 100 Parks brauchen Tenancy, TS-Warehouse, Ops-SLOs.
12. Wenn ich CEO wäre – was ich morgen zuerst baue
Ein Objekt: „Operational Case“ (Incident) End-to-End: aus Queue/Ride/UNS-Event erzeugbar, mit Owner, SLA-Timer, Audit-Trail, einem Ops-Screen und einem Management-Report („Top 10 Ursachen, MTTR, wiederkehrende Assets“).
Parallel: Forecast Accuracy sichtbar machen. Das ist die kürzeste Linie von Technik zu verifizierbarem Business Value und unterscheidet euch von „noch einem Dashboard“.

Investor-Linse (kurz)
Warum investieren: Tiefe vertikale Integration (MDM + Stream + AI + UNS) ist selten; gut skalierbar als Infrastruktur-Schicht für Parks.
Warum nicht: Enterprise-Sales-Zyklus ohne SSO/Compliance/klare ROI-Metriken ist hart; Konkurrenz durch Systemintegratoren + Hersteller (Zamperla, etc.) und durch Ticketing-Giganten mit Gästedaten.

Für ~10M Bewertung: Wiederkehrende Umsätze, 3–5 zahlende Referenzparks, defensible Datenpipelines, messbare Labor/Queue-Outcomes.
Für ~100M: Standard im Konzern-Portfoliomanagement, Partner-Ökosystem, starke Network Data Moats (Benchmark) oder regulatorisch/operativ unverzichtbar (Safety + Workforce + Twin).

Wenn du willst, kann als nächster Schritt (ohne Blabla) eine konkrete Roadmap-Tabelle mit Impact × Aufwand × Abhängigkeiten nur für einen Bereich (z. B. nur Multi-Tenant + SSO, oder nur Ops/Incident) erstellt werden – sag welcher Bereich für dich zuerst „verkaufbar“ sein muss.