# Smart Park OS

> **Operations-Plattform für große Freizeit- und Publikumsanlagen.**
> Wir verbinden Live-Daten, Master Data und KI zu einer einzigen Quelle der
> Wahrheit für Tagesbetrieb, Personalplanung und Gästesicherheit.

Freizeitparks, Resorts, Stadien und Zoos verlieren täglich Geld, weil
Wartezeiten, Personalbedarf, Wetter, Wartung und Gästeströme in **getrennten
Tools** leben. Smart Park OS legt eine **gemeinsame operative Schicht**
darüber – als Plattform, nicht als weiteres Dashboard.

---

## Inhalt

- [Das Problem](#das-problem)
- [Was Smart Park OS ist](#was-smart-park-os-ist)
- [Wertversprechen pro Rolle](#wertversprechen-pro-rolle)
- [Plattform-Bausteine](#plattform-bausteine)
- [Outcome-Metriken](#outcome-metriken)
- [Differenzierung](#differenzierung)
- [Zielmärkte](#zielmärkte)
- [Reifegrad heute & Roadmap](#reifegrad-heute--roadmap)
- [Geschäftsmodell](#geschäftsmodell)
- [Architektur in einem Satz](#architektur-in-einem-satz)
- [Investor-Linse](#investor-linse)
- [Kontakt & Demo](#kontakt--demo)

---

## Das Problem

Operatoren großer Anlagen treffen heute Personal- und Sicherheits-
Entscheidungen mit **fragmentierten Werkzeugen**:

- Wartezeiten in einer App, Personal in Excel, Wetter im Browser-Tab,
  Wartung im CMMS, Vorfälle im Funkprotokoll.
- KI-Prognosen sind häufig Marketing-Charts ohne **belegbare Genauigkeit**.
- Multi-Park-Konzerne haben **keine vergleichbare Datengrundlage** zwischen
  Standorten – Best Practices skalieren nicht.
- Edge-/IoT-Daten (Fahrgeschäft, Drehkreuz, Wetterstation) werden
  bestenfalls für ein einziges Dashboard verwendet, nicht als
  wiederverwendbares Asset.

Das Ergebnis: **vermeidbare Wartezeit, überstundenlastige Schichtpläne,
verspätete Eskalationen, blinde Flecken bei Sicherheit und Umsatz.**

---

## Was Smart Park OS ist

Smart Park OS ist eine **vertikal integrierte Operations-Plattform**:

1. **Eine kanonische Datenschicht** – Master Data (Park, Zone, Asset),
   Live-Signale (Wartezeit, Auslastung, Status) und Kontext (Wetter, Ferien,
   Events) werden in einem versionierten Modell zusammengeführt.
2. **Ein Echtzeit-Bus** – via MQTT/Sparkplug B und einem **Unified Namespace
   (UNS)** sprechen alle Datenquellen denselben Adressraum, ob Cloud-API
   (z. B. Wartezeiten-Anbieter), Wetterdienst oder zukünftiger PLC-Edge.
3. **Eine Entscheidungsschicht** – Forecasts, Empfehlungen, Heatmaps,
   Vorfall-/Schichtmanagement und Simulation greifen auf dieselben Fakten zu
   und werden gegen Ist-Werte messbar gemacht.

Statt "noch ein Dashboard" liefern wir das **Betriebssystem**, auf dem
Gäste-Erlebnis, Workforce und Sicherheit zusammenlaufen.

---

## Wertversprechen pro Rolle

| Rolle | Heutige Pein | Was Smart Park OS liefert |
|---|---|---|
| **Park-GM / COO** | Tagesentscheidungen aus Bauchgefühl & Funkverkehr | Eine Live-Sicht über Auslastung, Wetter, Personal und offene Vorfälle |
| **CFO / Controlling** | KI-Investitionen ohne ROI-Nachweis | Forecast-Genauigkeit (MAPE) je Asset & Horizont, eingesparte Personalstunden, vermiedene Queue-Minuten |
| **Workforce Planner** | Excel-Schichtpläne, manuelle Umverteilung | Empfehlungen für Umverteilung & Sicherheit, Skill-/Zertifikats-bewusst (Roadmap) |
| **Safety / Security** | Eskalationen kommen zu spät | Crowd-Spike-Erkennung mit automatischer Empfehlung (Security entsenden, Gäste umleiten) |
| **Maintenance** | Downtime ohne strukturierte Codes | Vorfall-Objekt mit Owner, SLA-Timer, Audit-Trail (Roadmap: CMMS-light) |
| **IT / Integration** | Jede neue Quelle = Custom-Integration | Adapter-Framework, kanonische Nachrichten, UNS-Topics, Sparkplug-Bus |
| **Konzern-Portfolio** | Parks vergleichen ist eine Reporting-Saison | Mandantenfähigkeit & Multi-Park-Roll-up (Roadmap) |

---

## Plattform-Bausteine

Geordnet nach **Geschäftsnutzen**, nicht nach Technologie.

### 1. Live Operations Cockpit
Crowd-Heatmap, Rides-Tabelle (Status, Wartezeit, Durchsatz), Personalboard
pro Zone, priorisierte Empfehlungen. Alles über WebSocket live aktualisiert.
**Outcome:** Schnellere Reaktion, weniger Funk-Chaos.

### 2. Forecast & KI
Wartezeit-, Crowd- und Bedarfsprognosen je Park, Zone und Fahrgeschäft –
mit **Forecast-vs-Actual-Tracking** und Influence-Faktoren-Konfiguration
(Wetter, Ferien, Events). **Outcome:** KI wird verkaufbar, weil sie messbar
ist.

### 3. Master Data Management (MDM)
Eine kanonische Sicht auf Parks, Zonen, Fahrgeschäfte, Restaurants,
Theoretische Kapazitäten, Zykluszeiten, Signal-Capabilities. Trennung
zwischen "Golden Asset" und Provider-Entität.
**Outcome:** Berichte, KI und Integrationen sprechen vom selben Objekt.

### 4. Integration & Adapter
Adapter-Pakete für externe Quellen (z. B. ThemeParks-Wartezeiten,
Wetterdienste, Schulferien-Kalender, OPC UA Edge) liefern in ein
**kanonisches Inbound-Modell**. Mappings, Daten-Qualitäts-Issues und
Reprocessing sind Erstklass-Features. **Outcome:** Neue Quelle in Tagen,
nicht Quartalen.

### 5. Unified Namespace (UNS) + Sparkplug B
Stabiler, geschäftsorientierter Adressraum (`tpuns/{park}/v1/...`) **plus**
industrieller MQTT-Transport (Sparkplug B). Cloud-Adapter und
zukünftige PLC-Edges nutzen denselben Bus. **Outcome:** ein Datennetz, das
mit der Anlage mitwächst.

### 6. Daten-Qualität & Audit
Jede externe Nachricht wird roh gespeichert, validiert und auditierbar
verarbeitet. Fehlgeschlagene Mappings werden als Vorfälle sichtbar.
**Outcome:** kein "Black-Box-KI"-Misstrauen mehr.

### 7. Simulator
Synthetische Szenarien (Crowd-Spike, Ride-Down, Wetter) für Demos,
Schulung und Algorithmus-Tests – ohne reale Gästedaten.
**Outcome:** sicheres Üben, glaubwürdige Demos, RL-fähig (Roadmap).

### 8. Vorfall- & Schicht-Management *(Roadmap, in Arbeit)*
"Operational Case" als Erstklass-Objekt: aus Queue/Ride/UNS-Event erzeugbar,
mit Owner, SLA-Timer, Audit-Trail, Post-Mortem.
**Outcome:** Ops ohne Case-Objekt skaliert nicht – wir bauen das Objekt.

### 9. Multi-Park & Enterprise *(Roadmap)*
Mandanten-Modell (Org → Park → Site), Row-Level Security, SSO/SCIM,
Webhook-Events, API-Keys, Billing/Metering.
**Outcome:** vom Pilot zum Konzern-SaaS.

---

## Outcome-Metriken

Was wir **messbar** machen wollen – und worauf Pricing langfristig fußen
darf:

| Kategorie | Beispiel-KPI |
|---|---|
| Gäste-Erlebnis | Vermiedene Queue-Minuten (kumuliert / pro Tag) |
| Workforce | Eingesparte Personalstunden pro 1.000 Gäste |
| KI-Vertrauen | MAPE der Wartezeit-Prognose je Top-Ride und Horizont |
| Sicherheit | Mean Time to Acknowledge / Resolve bei Crowd-Spikes |
| Wartung | Ungeplante Downtime-Minuten je Asset |
| Datenqualität | Adapter-Latenz, Anteil `NEEDS_REVIEW`-Mappings |

Diese Metriken sind kein Marketing – sie sind die **Sprache, in der ein CFO
einen Vertrag verlängert.**

---

## Differenzierung

Was Smart Park OS **anders** macht:

- **Vertikaler Stack**: MDM + Stream + UNS + KI in *einem* Produkt – nicht
  drei Hersteller, drei Logins, drei Datenkopien.
- **Industrie-Standard-Bus**: Sparkplug B / UNS – derselbe Adressraum, den
  Industrie-4.0-Werke bereits nutzen. Edge-Geräte können später ohne
  Re-Plattform anbinden.
- **Adapter-First-Architektur**: jede neue Quelle ist ein versioniertes
  Paket, kein Custom-Code-Branch.
- **Beweisbare KI**: Forecast-Genauigkeit ist ein eigenständiges Produkt-
  Surface, kein Backoffice-Notebook.
- **Operator-zentrierte UX-Strategie**: Bedienung "bei Sonne, mit
  Funkgerät, im Lärm" – nicht Consumer-SaaS-Optik.

Wir sind näher an "Palantir / Foundry für Parks" als an "Disney Genie +
Workforce-ERP" – und positionieren uns bewusst als die **Operations-
Datenplattform**, auf der andere Lösungen aufsetzen können.

---

## Zielmärkte

- **Freizeit- und Themenparks** (Tier-1 und Mittelstand)
- **Resorts mit Hotel-/Park-Verbund** (Gäste-Vorausplanung, Hotelflüsse)
- **Großzoos und Aquarien** (Crowd-Routing, Tier-Sicherheits-Zonen)
- **Stadien und Arenen** (Event-Tagesbetrieb, Sicherheits-Zonen)
- **Konzern-Portfolios mit mehreren Standorten** (Benchmarking,
  Standardisierung)

Sekundär: **Systemintegratoren** und **Hersteller**, die Smart Park OS
als White-Label- oder OEM-Schicht einsetzen.

---

## Reifegrad heute & Roadmap

### Heute produktiv im Repo
- API + Live-Cockpit (Vue 3) mit Echtzeit-Updates
- Master Data, Park-Kontext, Rollen-/Rechtemodell (RBAC)
- Adapter-Framework + erste Adapter (ThemeParks-Wartezeiten,
  Wetter, Schulferien, OPC UA Edge)
- Kanonisches Inbound-Modell, Daten-Qualitäts-Issues, Reprocessing
- UNS-Topic-Generator, Canonical-to-Sparkplug-Publisher,
  Eclipse-Mosquitto-Broker per Docker Compose
- Forecast-Pipeline, Feature-Snapshots, Forecast-Accuracy-Surface
- Simulator mit Szenarien, Audit-Trails, Daten-Import
  (Staff/Rides/Zones)

### Quick Wins (~30 Tage Plan)
- Vorfall-MVP (anlegen, Status, Owner, Ride-/Zone-Bezug)
- Forecast-vs-Actual-Dashboard (7 Tage, Top-Rides)
- Alarm-Routing mit Ruhezeiten
- Executive-Single-Page (5 KPIs)
- API-Keys (scoped, rotierbar)

### Mittelfristig (~90 Tage)
- SSO (OIDC/SAML) + SCIM
- Work Orders aus UNS/Alarm (Dispatch)
- Skill-Matrix + Ablaufdaten
- Heatmap MVP, SLA-Monitor
- Webhook-Events

### Game Changer (12 Monate)
- Closed-Loop Operations: Event → Case → Task → Asset → Post-Mortem → Playbook
- Eingebetteter Optimizer (MIP/CP-SAT) für Schichten
- "Park Digital Twin"-Graph + SDK für Integratoren
- Industrie-Benchmark-Datenpool (anonymisiert, opt-in)
- Marketplace für Adapter (Wetter, Ticketing, …)

Die ausführliche Variante steht in
[`docs/Roadmap_BusinessCase.md`](docs/Roadmap_BusinessCase.md) und
[`docs/Roadmap.md`](docs/Roadmap.md).

---

## Geschäftsmodell

| Tier | Kern | Monetarisierung |
|---|---|---|
| **Basic** | MDM + Live-Dashboards + Audit | pro Park / capped Assets |
| **Pro** | + Integrationen, UNS Explorer, Webhooks, SSO | pro Park + Integrations-Runs |
| **Enterprise** | Multi-Park, SCIM, SLA, dediziertes Deployment | Jahresvertrag + Professional Services |
| **AI Premium** | Forecasts + Recommendations + Optimizer + Accuracy SLA | Metered (Predictions, Optimizer-Runs) oder % an nachweisbar eingesparten Stunden |

**Upsells:** Historian-Speicher, zusätzliche Edge-Gateways, Benchmark-Pool,
White-Label, Premium-Support, Integratoren-Pakete.

---

## Architektur in einem Satz

> Quellen (Adapter, Edge, Wetter) → **kanonisches Inbound-Modell** →
> **UNS / Sparkplug-Bus** → **Historian + Feature Store** →
> **Forecast + Empfehlungen** → **Live-Cockpit & APIs** – jede Schicht
> testbar, versionierbar, mandantenfähig.

Technische Tiefe (HTTP, Adapter, MQTT-Topics, ADRs) lebt bewusst in
[`README.md`](README.md) und unter [`docs/`](docs/).

---

## Investor-Linse

**Warum jetzt:** Der Markt für Park-Operations-Software ist fragmentiert,
KI-fähige Datenpipelines sind selten, und Edge-/IoT-Standards (UNS,
Sparkplug) erreichen gerade Reife. Wer **vertikal integriert** ist, gewinnt.

**Warum wir:** Echte Datenpfade, ein Adapter-Modell, kanonisches Modell,
UNS-Bus, Forecast-Loop und ein klar artikulierter Enterprise-Pfad
(Tenant, SSO, SLA). Tiefer als ein Dashboard-Anbieter, breiter als ein
einzelner Adapter-Vendor.

**Was uns trägt:**
- 3–5 zahlende Referenzparks mit messbaren Outcomes
- Defensible Datenpipelines (Adapter, UNS, Feature Store)
- Glaubwürdige KI durch sichtbare Genauigkeit
- Standardisierter Konzern-Roll-up als Netzwerkeffekt

---

## Kontakt & Demo

- **Live-Demo / Pilot-Anfrage:** *(Kontakt einsetzen)*
- **Investor-Deck:** *(auf Anfrage)*
- **Repository (Tech):** [`README.md`](README.md)
- **Build Guide (für Entwickler):** [`BUILD.md`](BUILD.md)
- **Roadmap & Business Case:**
  [`docs/Roadmap_BusinessCase.md`](docs/Roadmap_BusinessCase.md)

---

*Smart Park OS — die Operations-Schicht für Anlagen, in denen jede Minute
Wartezeit und jede Schichtstunde zählt.*
