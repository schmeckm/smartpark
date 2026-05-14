# Konzept: Agentic AI Agent in Smart Park OS

> **Status:** Konzept / Design-Vorschlag
> **Zielgruppe:** Engineering, Produkt, Investor-Linse
> **Verwandt:** [`PRODUCT.md`](../PRODUCT.md), [`docs/Roadmap.md`](Roadmap.md),
> [`docs/architekur.md`](architekur.md), [`docs/Improvement.md`](Improvement.md),
> [`docs/adr/0001-forecast-architecture.md`](adr/0001-forecast-architecture.md)

---

## 1. Warum überhaupt ein Agent?

Smart Park OS hat heute zwei KI-„Modi“:

1. **Predictive AI** — Forecasts (`forecasts`, Feature Store), Accuracy-Tracking,
   Park/Zone/Ride-Prognosen.
2. **Rule-based Recommendations** — `RecommendationEngineService` reagiert auf
   `CROWD_SPIKE` (Schwellen 75 % / 90 %, Severity ≥ 4) und schlägt
   `REALLOCATE_STAFF`, `SEND_SECURITY`, `GUEST_ROUTING` vor.

**Was fehlt:** Eine Schicht, die zwischen *Vorhersage* und *Mensch entscheidet*
**eigenständig komponiert**: Sie kombiniert Forecast + Live-Status + Wetter +
Personalverfügbarkeit + offene Incidents zu einer **Handlungsabsicht**, holt sich
fehlende Daten selbst, plant Schritte, schlägt sie vor, **wartet auf Freigabe**
und setzt sie um — mit lückenlosem Audit.

Genau das ist der **Agentic AI Agent**: kein neues Modell, sondern ein
*Orchestrator mit Werkzeugen*, der Forecasts, Recommendations, MDM, UNS,
Incidents und Schichten als **Tools** benutzt.

> Positionierung gegenüber Investoren: Smart Park OS hat einen *kanonischen
> Datenraum* (UNS, MDM, Adapter), eine *messbare Forecast-Ebene* — und auf dieser
> Basis einen *Closed-Loop Operator-Co-Pilot*. Drei Hersteller schaffen so etwas
> nicht; vertikale Integration zahlt sich aus.

---

## 2. Was der Agent **nicht** ist

Damit das Konzept tragfähig bleibt, klare Abgrenzung:

| Nicht | Sondern |
|---|---|
| Ein Chatbot, der Tabellen ausliest | Ein Operator-Co-Pilot mit Aktions-Tools und Audit |
| Ein neuer ML-Trainings-Pfad | Ein Konsument der bestehenden Forecast-/Feature-Store-Pipeline (siehe ADR 0001) |
| Ein Ersatz für die Recommendation-Engine | Eine **übergeordnete Schicht**, die Recommendations als *eines von mehreren* Werkzeugen nutzt |
| Eine Black-Box | Jeder Schritt persistiert: Eingabe, Reasoning-Trace, Tool-Calls, Outputs, Approval |
| „Volle Autonomie ab Tag 1“ | Standard ist **Human-in-the-Loop** mit Auto-Modus pro Skill, Park und Risikoklasse opt-in |

---

## 3. Use-Case-Katalog (operativ, an Personas)

Geordnet nach **wem es nützt** — anschließbar an die Personas in `PRODUCT.md`.

### 3.1 Operations Co-Pilot (Park-GM / Duty Manager)

- **Crowd-Spike-Triage:** Agent erkennt Spike (UNS-Event), prüft *adjacent zones*,
  Personalverfügbarkeit pro Skill, Wetter, offene Incidents — und schlägt einen
  konkreten **Maßnahmenplan** vor (z. B. „2 FOOD_SERVICE-Mitarbeiter aus Zone B
  → Zone A für 45 Min, Security an Eingang Ride X, Gäste-Routing über App
  aktivieren“). Heute ist das hartcodierte Logik in `recommendation-engine.service.js`.
- **Ride-Down-Reaktion:** UNS-Status `DOWN`/`E_STOP` → Agent öffnet Incident,
  benachrichtigt Maintenance, prüft Routing-Auswirkungen auf Nachbar-Rides, schlägt
  Kommunikations-Bausteine vor (Push, App, Anzeige).
- **Wetter-Pivot:** Forecast „Regen in 60 Min, Confidence > 0.7“ → Agent schlägt
  Indoor-Verlagerung, Personal-Umschichtung Outdoor → Indoor, Pre-Briefing für
  Show-Slots vor.
- **Schicht-Übergabe:** Am Schichtende fasst der Agent automatisch das Logbuch
  zusammen (Spikes, Incidents, Forecast-Abweichung, offene Cases) und schreibt
  einen **strukturierten Handover-Eintrag** in `PlatformShiftHandover*`.

### 3.2 Workforce Planner

- **Bedarfs-Empfehlung pro Zone/Stunde**, abgeleitet aus Crowd-Forecast,
  Skill-Matrix, Öffnungszeiten — als Vorschlag, nicht als verbindliche Schicht.
- **Tagesabschluss-Diff:** Geplant vs. Ist, pro Zone, mit Begründung
  („Zone A unter Plan – Forecast überschätzte Crowd um 18 %; Wetterfaktor`rain` aktiv“).

### 3.3 Safety / Security

- **Eskalations-Loop:** Crowd-Spike → Agent fragt Live-Density, fragt Wetter,
  fragt Event-Kalender, entscheidet *severity hint*, eröffnet Incident bei
  Schwelle, schlägt Security-Routing vor — mit klarer Begründung (Tooltip im UI).

### 3.4 Maintenance

- **Predictive-Maintenance-Brücke:** Agent kombiniert
  `predictive-maintenance.service` + Downtime-Historie + Wartungsfenster-Kalender,
  schlägt **Wartungsslot-Verschiebung** vor, wenn Crowd-Forecast es erlaubt.

### 3.5 Data / IT (Plattform-Operator)

- **Adapter-Health-Triage:** Wenn ein Adapter (z. B. `themeparks_wiki`) Anomalien
  zeigt (Lag, `NEEDS_REVIEW`-Mappings steigen), eröffnet der Agent einen
  Plattform-Incident und schlägt Reprocess oder Mapping-Reviews vor.
- **Mapping-Assistent:** Bei `NEEDS_REVIEW` prüft der Agent Namens-Ähnlichkeit,
  Kategorie-Übereinstimmung, Kapazitäts-Plausibilität — und schlägt Mappings vor,
  setzt sie aber nicht ohne Freigabe.

### 3.6 Konzern / Multi-Park (Roadmap-bezogen)

- **Cross-Park-Benchmark-Agent:** „Park A erreicht heute 18 % höhere
  `actual_throughput` als Park B bei vergleichbarem Forecast — Ursachen-Hypothesen?“
  → Generiert Hypothesen-Liste auf Basis MDM-Differenzen (Capacity, Cycle,
  Personal-Dichte).

### 3.7 Investor-/Executive-Linse

- **Tagesnarrative:** Agent erzeugt einen **One-Pager** je Tag/Park aus den
  Outcome-Metriken (vermiedene Queue-Minuten, MAPE Top-Rides, MTTA
  Crowd-Spikes) — direkt aus existierenden Endpoints.

---

## 4. Logische Architektur

### 4.1 Komponenten-Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│                     Trigger-Layer                                │
│  Socket.IO-Events  •  Cron  •  Manuelle Trigger (UI/CLI)        │
│  (z. B. events:created, recommendations:created, mqtt-spike,   │
│   ai_pipeline.run.completed, dataquality:new)                   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│              Agent Runtime (neu: src/services/agentic/)         │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────────┐ │
│  │ Skill-Router │→ │ Planner /   │→ │ Tool-Executor (Loop)   │ │
│  │ (Intent)     │  │ Reasoner    │  │ + Guardrails           │ │
│  └──────────────┘  └─────────────┘  └────────────────────────┘ │
│         │                  │                    │               │
│         ▼                  ▼                    ▼               │
│   Skill-Registry    Memory (kurz/lang)    Audit & Trace         │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                Tool-Layer (kontrollierte Capabilities)          │
│  Read-Tools          Action-Tools (mutating)                    │
│  • mdm.query         • incident.open / update                   │
│  • forecast.read     • recommendation.score / dismiss           │
│  • uns.read          • staff.suggest_reallocation               │
│  • dataquality.list  • shift.handover.append                    │
│  • weather.read      • simulator.run_scenario                   │
│  • incidents.list    • notify.dispatch (E-Mail / Push)          │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Bestehender Stack: REST/Sequelize • UNS/Sparkplug • Forecasts  │
│                       • Audit-Log • RBAC                         │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Verhältnis zur bestehenden Pipeline

- Der Agent **konsumiert** den `AiOrchestratorService` und die
  `RecommendationEngineService`. Er **ersetzt** sie nicht. ADR 0001 bleibt
  Vorrang.
- Der Agent darf **niemals** direkt in MDM-/Domain-Tabellen schreiben.
  Mutationen laufen über **bestehende Service-APIs** (Incident, Recommendation,
  Schicht, Notification). Damit bleiben RBAC, Audit, Validierung wirksam.
- Der Agent ist **selbst ein Adapter** im Sinne des Stacks: Eingaben
  kanonisch, Ausgaben strukturiert, Audit Pflicht.

---

## 5. Skills statt „One Big Agent“

Wir bauen **kein** allwissendes Modell, sondern **klar zugeschnittene Skills**.
Das ist deterministischer, testbar, und pro Skill freigeschaltet (Feature Flag
+ RBAC + Park-Scope).

| Skill ID | Trigger | Tools (read) | Tools (write) | Default-Modus |
|---|---|---|---|---|
| `crowd_spike_triage` | `events:created` (CROWD_SPIKE) | mdm, forecast, uns, weather, staff, incidents | recommendation.score, notify.dispatch | **Suggest** |
| `ride_down_response` | UNS `status=DOWN` | mdm, incidents, predictive_maintenance | incident.open, notify.dispatch | **Suggest** |
| `weather_pivot` | weather:updated (Confidence-Threshold) | forecast, weather, mdm, staff | recommendation.score | **Suggest** |
| `shift_handover_writer` | Cron (Schichtende) | incidents, recommendations, forecast, audit | shift.handover.append | **Auto** (read-only zusammenfassen) |
| `mapping_assistant` | `dataquality:new` (NEEDS_REVIEW) | mdm, integrations | – (nur Vorschlag) | **Suggest** |
| `adapter_health_triage` | Lag/Fehler-Schwelle | integration_event_logs, canonical | incident.open (interner Plattform-Incident) | **Auto** |
| `daily_executive_brief` | Cron 1×/Tag | dashboard.summary, accuracy, recommendations | report.generate | **Auto** |

**Modi:**

- **Suggest** — Vorschlag landet als „Agent-Empfehlung“ im UI, Mensch genehmigt.
- **Approve** — der Agent darf an seine Tools, aber jede mutierende Aktion
  benötigt **explizite Freigabe** (z. B. Slack/Teams/E-Mail mit Token-Link).
- **Auto** — nur für *risikofreie* Skills (z. B. read-only Zusammenfassung,
  interner Plattform-Incident). Pro Park abschaltbar (`agent.skills.{id}.mode`).

---

## 6. Datenmodell-Erweiterung

Minimal-invasiv — drei neue Tabellen, der Rest fügt sich in Bestehendes.

### `agent_runs`
Eine Zeile pro Agentenlauf (eine Skill-Invocation, evtl. mehrere Tool-Calls).

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | UUID | PK |
| `park_id` | UUID FK | Tenant-Scope |
| `skill_id` | TEXT | z. B. `crowd_spike_triage` |
| `mode` | ENUM | `suggest` / `approve` / `auto` |
| `trigger_type` | ENUM | `socket` / `cron` / `manual` |
| `trigger_ref` | TEXT | z. B. Event-ID, User-ID |
| `status` | ENUM | `running` / `succeeded` / `failed` / `awaiting_approval` / `cancelled` |
| `started_at`, `ended_at` | TIMESTAMPTZ | |
| `model_version` | TEXT | LLM-/Modellversion (Audit) |
| `input_summary` | JSONB | Eingabe-Snapshot (gekürzt) |
| `output_summary` | JSONB | Ergebnis (z. B. „erstellt Incident #123, schlug 2 Reallocations vor“) |
| `cost_tokens` / `cost_ms` | INT | für Metering |
| `correlation_id` | UUID | verbindet zu Forecast / Event / Recommendation |

### `agent_steps`
Reasoning- und Tool-Trace. Append-only, wichtig für Compliance/Debugging.

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | UUID | PK |
| `run_id` | UUID FK | → `agent_runs` |
| `step_index` | INT | Reihenfolge |
| `kind` | ENUM | `plan` / `tool_call` / `tool_result` / `note` / `final` |
| `tool_name` | TEXT NULL | z. B. `forecast.read` |
| `arguments` | JSONB NULL | Tool-Argumente (mit redacted-Markern) |
| `result` | JSONB NULL | gekürzter Output |
| `error` | TEXT NULL | |
| `duration_ms` | INT | |
| `created_at` | TIMESTAMPTZ | |

### `agent_actions`
Jede **mutierende** Aktion, die der Agent vorgeschlagen oder ausgeführt hat.
Bindeglied zu Approval-Workflow und Outcome-Messung.

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | UUID | PK |
| `run_id` | UUID FK | |
| `action_type` | TEXT | z. B. `OPEN_INCIDENT`, `REALLOCATE_STAFF` |
| `target_type` | TEXT | `incident` / `recommendation` / `shift` / `notification` |
| `target_id` | UUID NULL | |
| `payload` | JSONB | Vorschlag in normalisierter Form |
| `status` | ENUM | `proposed` / `approved` / `applied` / `rejected` / `expired` |
| `approved_by_user_id` | UUID NULL | |
| `approved_at` | TIMESTAMPTZ NULL | |
| `expires_at` | TIMESTAMPTZ NULL | Vorschlag verfällt nach X Min — wichtig für Live-Ops |
| `outcome_metric` | JSONB NULL | gemessener Effekt (z. B. „Wartezeit 12 Min reduziert“) |

**Indizes (Pflicht):**
- `agent_runs (park_id, started_at DESC)`
- `agent_runs (skill_id, status, started_at DESC)`
- `agent_steps (run_id, step_index)`
- `agent_actions (status, expires_at)` — für „pending approvals“-View

> **Hinweis (passend zu `Improvement.md`):** Append-Only-Tabellen
> (`agent_steps`) brauchen ab 10+ Parks **Partitionierung** nach
> `(park_id, month)`. Vorbereiten in der ersten Migration.

---

## 7. API-Surface (`/api/v1/agent/...`)

| Methode | Pfad | Zweck | RBAC |
|---|---|---|---|
| `GET` | `/agent/skills` | Verfügbare Skills + Modus pro Park | `agent.read` |
| `PATCH` | `/agent/skills/:id` | Modus / Enabled / Schwellen | `agent.manage` |
| `GET` | `/agent/runs` | Liste mit Filter (Skill, Status, Park, Zeit) | `agent.read` |
| `GET` | `/agent/runs/:id` | Detail inkl. Steps und Actions | `agent.read` |
| `POST` | `/agent/runs` | Manueller Trigger eines Skills | `agent.run` |
| `GET` | `/agent/actions` | Pending Approvals | `agent.review` |
| `POST` | `/agent/actions/:id/approve` | Freigabe (führt Tool aus) | `agent.approve` |
| `POST` | `/agent/actions/:id/reject` | Ablehnung mit Begründung | `agent.review` |
| `POST` | `/agent/actions/:id/feedback` | Outcome-Feedback (Mensch) | `agent.review` |

**Neue RBAC-Permissions** (gemäß SSoT-Plan aus `Improvement.md`):
`agent.read`, `agent.run`, `agent.review`, `agent.approve`, `agent.manage`.
Die Trennung `review` vs. `approve` ist bewusst – „Vier-Augen“ pro Park möglich.

**Socket.IO-Events** (passt zu eurem bestehenden Eventing):
- `agent:run:started`, `agent:run:finished`, `agent:run:failed`
- `agent:action:proposed`, `agent:action:applied`, `agent:action:rejected`

---

## 8. UI-Konzept

Drei neue Views im `admin-dashboard`, eingebettet in eure bestehende Nav
(unter `Intelligence` aus dem Vorschlag in `Improvement.md`):

### 8.1 `/agent/inbox` (für Duty Manager)
- **Pending Actions**-Liste: was schlägt der Agent gerade vor?
- Pro Karte: *Was, Warum, Erwarteter Nutzen, bis wann gültig.*
- Buttons: **Approve / Reject / Edit-and-Approve**.
- Filterbar nach Park, Skill, Risiko.
- **Mobile-first** (Live-Ops-Realität: Funkgerät + Smartphone).

### 8.2 `/agent/runs/:id` (Trace-Viewer)
- Zeitleiste: Trigger → Plan → Tool-Calls → Final.
- Jeder Tool-Call **expandable** mit Argumenten/Ergebnis (PII redacted).
- „Replay this run“ (Simulator-Brücke, s. § 12).

### 8.3 `/agent/skills` (Plattform-Admin)
- Tabelle aller Skills, je Park: Modus, Schwellen, letzte 24h-Stats
  (Runs, Approval-Rate, Outcome).
- Schalter „Pause Skill“ (Kill-Switch pro Park).

> **UI-Regel** (analog zu eurer Forecast-Regel): Jede Empfehlung des Agenten
> hat einen Tooltip mit *Skill-ID, Modellversion, Trigger-Quelle, Confidence,
> verwendete Tools*. „Black-Box“-Kästchen sind verboten.

---

## 9. Sicherheit, Guardrails, Failure Modes

### 9.1 Hard Guardrails (im Agent-Runtime, nicht im LLM-Prompt)

- **Whitelist-only Tools.** Der Agent kann ausschließlich registrierte
  Tools aufrufen. Tool-Schemas sind in TypeScript/JSON-Schema definiert,
  alles andere wirft.
- **Park-Scope Pflicht.** Jeder Tool-Call erhält `parkId` aus dem Run-Kontext.
  Tools, die keinen Park-Scope akzeptieren, sind als „global“ markiert und
  **nur für Admin-Skills** freigegeben.
- **Rate Limits pro Skill und Park.** z. B. max. 1 `notify.dispatch` pro
  Minute pro Zone — verhindert Notification-Storms.
- **Action-Quoten.** Pro Skill und Tag eine harte Obergrenze (z. B. „max. 5
  REALLOCATE_STAFF/Tag/Park ohne Eskalation an Manager“).
- **Approval-Pflicht** für alle Schreib-Tools im Modus `suggest`/`approve`.
- **Idempotenz.** Action-Payloads werden mit `correlation_id` gehasht;
  dieselbe Maßnahme nicht doppelt vorschlagen, solange `expires_at` läuft.

### 9.2 Soft Guardrails (Modell-/Prompt-Ebene)

- System-Prompt enthält **Park-Kontext**, **Rolle** und **erlaubte Tools**
  als Liste — *vor* der Aufgabenbeschreibung.
- Pflicht-Antwortstruktur: jede Aktion **mit Begründung** und **Confidence**.
- **Refusal-Regel:** Wenn Pflichtdaten fehlen (z. B. Personalbestand der
  Nachbarzone), **erst** das Tool aufrufen, **dann** entscheiden — nie raten.

### 9.3 Failure Modes (explizit testen)

| Fall | Verhalten |
|---|---|
| Tool wirft 5xx | Step `error`, Skill versucht max. *N* Retries mit Backoff, dann `failed` |
| LLM halluziniert Tool-Name | Schema-Reject, Step `failed`, kein Outbound |
| Action expired bevor Approval | Status `expired`, neue Run-Instance möglich |
| Pflicht-Approval bleibt aus | Status `expired` + Notification an Eskalations-Empfänger |
| Modell offline | Skill markiert `degraded`; UI zeigt Banner; nur regel-basierte Recommendations laufen |

---

## 10. Messbarkeit (entscheidend für Verkauf und Investor-Linse)

**Ohne diese Metriken ist der Agent ein Demo, kein Produkt.**

| Kategorie | Metrik | Erfasst über |
|---|---|---|
| Adoption | Approve-Rate je Skill | `agent_actions.status` |
| Qualität | „Edit-and-Approve“-Rate (Mensch korrigiert) | `agent_actions` + diff |
| Geschwindigkeit | Mean Time From Trigger To Approval | `agent_runs` + `agent_actions` |
| Outcome | Vermiedene Queue-Minuten / Run | Brücke zu existenten Forecast-vs-Actual-Metriken |
| Sicherheit | MTTA Crowd-Spikes (mit/ohne Agent) | `incidents` + `agent_runs` korrelieren |
| Kosten | Tokens / Run und €/100 Aktionen | `agent_runs.cost_*` |
| Vertrauen | False-Positive-Rate (`rejected` mit Grund „nicht relevant“) | `agent_actions.status` |

Diese Metriken sind **direkt** ein neuer Block auf
`/admin/intelligence/agent` und ein KPI im Executive-Single-Pager.

---

## 11. RBAC- und Tenant-Sicht

- Bestehende RBAC-Architektur weiterführen — neue Permissions wie oben.
- **Park-Kontext** (`X-Park-Id` Middleware) ist Pflicht für *alle* Agent-APIs.
- Eingebettet in das künftige Multi-Tenant-Modell aus der Roadmap (Org → Park
  → Site). Der Agent darf **niemals** Park-Grenzen überschreiten, außer für
  ausdrücklich „global“ markierte Skills (z. B. `daily_executive_brief` im
  Konzern-Roll-up — separater Permission-Check `agent.cross_park`).

---

## 12. Verbindung zu existierenden Bausteinen

| Bestehender Baustein | Rolle für den Agenten |
|---|---|
| `AiOrchestratorService` | Liefert frische Forecasts/Snapshots (Tool `forecast.read`) |
| `RecommendationEngineService` | Wird vom Agenten **aufgerufen**, nicht ersetzt; Ergebnis fließt in den Plan |
| Canonical Inbound + UNS | Tool `uns.read` / `canonical.query` für Live-Status |
| `Incident` (Phase 1 Roadmap) | Primäre Schreib-Senke — der Agent öffnet/aktualisiert Cases |
| `Simulator` | **Replay** und **Skill-Test** vor Rollout: jeder Skill muss erst gegen Simulator-Szenarien grün sein, bevor er auf Prod-Park freigeschaltet wird |
| Audit-Log | Bekommt zusätzlich `agent_run_id` — eine Korrelation reicht für Compliance |
| Adapter-Framework | Der Agent ist ein **„virtueller Adapter“** für menschliche Entscheidungen — gleiche Disziplin (versionierte Schemas, Traces, Reprocess) |

---

## 13. LLM-/Runtime-Auswahl

Bewusst **modell-agnostisch** halten — eine `LlmProvider`-Abstraktion (analog zu
eurem Adapter-Pattern):

```
src/services/agentic/
  ├── runtime/
  │   ├── agent-runner.js       (Plan-Loop, Tool-Dispatch)
  │   ├── tool-registry.js      (Whitelist + Schemas)
  │   ├── memory.js             (Run-Memory, kurzfristig in agent_steps)
  │   └── guardrails.js         (Quoten, Idempotenz, Park-Scope)
  ├── providers/
  │   ├── openai.provider.js
  │   ├── anthropic.provider.js
  │   ├── azure-openai.provider.js
  │   └── local-ollama.provider.js   (für On-Prem-Kunden / Enterprise)
  ├── skills/
  │   ├── crowd-spike-triage.skill.js
  │   ├── ride-down-response.skill.js
  │   ├── weather-pivot.skill.js
  │   └── …
  └── tools/
      ├── read/  (forecast, mdm, uns, weather, …)
      └── write/ (incident, recommendation, notify, shift, …)
```

**Wichtig für Enterprise-Pfad:** `local-ollama.provider.js` (oder
self-hosted Mistral / Llama) ermöglicht On-Prem ohne Cloud-LLM. Das ist ein
Verkaufsvorteil bei Konzernen mit Datenschutz-Auflagen — und passt zu eurer
„Self-hosted oder SaaS“-Linie.

> Konsequenz: **kein** Modell-Lock-in in Datenmodell, API oder UI.

---

## 14. Phasenplan (an Roadmap.md angedockt)

### Phase A — Fundament (2 Wochen, parallel zu Incident-MVP / Phase 1)
1. Migrationen: `agent_runs`, `agent_steps`, `agent_actions`.
2. Tool-Registry + Read-only-Tools (`mdm.query`, `forecast.read`, `uns.read`,
   `weather.read`, `incidents.list`).
3. **Skill #1: `daily_executive_brief`** — read-only, Cron, **Auto-Modus**.
   Geringes Risiko, sofort sichtbarer Wert für Investor-Demo.
4. UI: `/agent/runs` (Liste + Detail). Noch keine Approvals nötig.

### Phase B — Erste „Suggest“-Skills (4–6 Wochen, parallel zu Forecast-Accuracy / Phase 2)
1. Write-Tools: `incident.open`, `recommendation.score`, `notify.dispatch`.
2. Approval-Workflow (`/agent/actions/:id/approve`).
3. **Skill #2: `crowd_spike_triage`** — Suggest-Modus. Lebt **neben** der
   bestehenden Regel-Engine; A/B-vergleichbar.
4. **Skill #3: `mapping_assistant`** — bei `NEEDS_REVIEW` Vorschläge.
5. UI: `/agent/inbox` mit Approve/Reject, Mobile-tauglich.

### Phase C — Closed Loop (8–12 Wochen, parallel zu Roadmap-Phase 3)
1. **Skill #4: `ride_down_response`** und **#5: `weather_pivot`**.
2. Outcome-Tracking (`agent_actions.outcome_metric`) via Forecast-vs-Actual-Brücke.
3. **Simulator-Replay** als Pflicht-Pre-Flight für jeden neuen Skill.
4. Pro Skill ein „Approval-Rate ≥ X“-Gate vor Auto-Modus-Freigabe.

### Phase D — Enterprise / Konzern (12+ Wochen, parallel zu Multi-Tenant)
1. `local-ollama.provider.js` als On-Prem-Option.
2. Cross-Park-Skills (`agent.cross_park`-Permission), Konzern-Benchmarks.
3. SSO/SCIM-konformes Approval (z. B. Slack/Teams-Bot mit OIDC-Login).
4. Metering-Endpoint pro Tenant (Tokens, Runs) — Voraussetzung für „AI Premium“-Tier.

---

## 15. Open Questions / explizit zu entscheiden

1. **LLM-Vendor für Phase A** — OpenAI (Time-to-Market) vs. self-hosted (Datenschutz).
   *Empfehlung:* OpenAI/Anthropic für Pilot, ab Phase D self-hosted Option.
2. **Approval-Kanal außerhalb der UI** — Slack/Teams ja, E-Mail-Token ja —
   aber wer ist Pflicht-Empfänger pro Park? → `agent.skills.{id}.approvers` als
   konfigurierbare Liste.
3. **Tone-of-Voice** für Operator-Kommunikation — kurze Funkspruch-ähnliche
   Sätze („Personal A→B, 30 Min, Grund: Crowd 92 %.“), nicht Marketing-Prosa.
4. **Modell-Eval-Pipeline** — wie testen wir Skill-Updates? → Kombination aus
   Simulator-Szenarien + gespeicherten realen Runs als Replay-Set.
5. **Datenschutz / PII** — falls je personenbezogene Daten (z. B. Hotel-Gäste)
   in den Agent-Kontext gelangen: Redaction-Layer **vor** Tool-Output an LLM.
   Heute kein Blocker, aber im Schema (`arguments JSONB`) bereits Redaction-Marker
   vorsehen.

---

## 16. Was man **morgen** tun kann (3 Tage Spike)

1. Migration für `agent_runs` + `agent_steps` + `agent_actions` schreiben (4–6 h).
2. `tool-registry.js` mit `forecast.read`, `dashboard.summary`, `incidents.list`
   als Read-only-Tools (1 Tag).
3. `daily_executive_brief.skill.js` — ein Skill, ein Cron, ein Markdown-Output;
   landet in `agent_runs` und ist im UI sichtbar (1 Tag).
4. Investor-Demo-Slide: „Smart Park OS hat einen Operator-Co-Pilot, der jeden
   Morgen das Tagesnarrativ schreibt — auf Basis derselben Forecast-Daten, deren
   Genauigkeit wir messbar zeigen.“

Damit ist das Konzept innerhalb einer Woche **kein Slide-Deck**, sondern ein
laufender, wenn auch minimaler, Skill — auf demselben Stack, der euch heute
schon trägt.

---

*Dieses Dokument ist ein Konzept, keine Spezifikation. Konkrete Schemas,
Prompts und Tool-Contracts entstehen in Phase A und werden über ADRs
(`docs/adr/`) festgeschrieben.*
