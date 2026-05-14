# Anleitung: Prognosen, KI-Studio und Diagnose (Admin-Dashboard)

Diese Kurzdoku richtet sich an **Benutzerinnen und Benutzer** des Smart-Park-Admin-Dashboards (nicht an Entwickler). Es beschreibt, **was Sie tun müssen**, damit die KI-Oberflächen sinnvoll funktionieren.

---

## 1. Voraussetzungen (immer zuerst)

| Schritt | Was Sie tun |
|--------|----------------|
| **Anmelden** | Mit Ihrem Konto einloggen. Ohne gültige Sitzung sind die Menüpunkte nicht oder nur eingeschränkt sichtbar. |
| **Park wählen** | Oben bzw. im Kontext **den Park auswählen**, für den Sie arbeiten. Viele KI-Funktionen beziehen sich auf **genau diesen** Park. |
| **Berechtigungen** | Für Prognosen und Diagnose brauchen Sie typischerweise Lesezugriff auf **KI** (`ai` · read). Für Training/Entwürfe im KI-Studio zusätzlich oft **KI aktualisieren** (`ai` · refresh). Fehlt eine Berechtigung, sehen Sie leere Listen oder Fehlermeldungen — dann wenden Sie sich an Ihre **Administratorin bzw. Ihren Administrator**. |
| **Integration / ThemeParks** | Für **Wartezeiten-Prognosen** pro Fahrgeschäft muss der Park in den Stammdaten eine **externe ThemeParks-Park-ID** (`externalEntityId`) haben und die Anbindung (Adapter/Integration) muss **betrieben** und mit Daten versorgt sein. Ohne externe Park-ID zeigt die Oberfläche einen Hinweis statt vollständiger Prognosen. |

---

## 2. Wartezeiten — Ist & Prognose (Haupteinstieg „Prognosen“)

**Menü:** KI / Insights → **Wartezeiten** (Route `/ai-insights`).

### Was Sie tun

1. **Park wählen** (siehe oben).
2. Seite **„Wartezeiten — Ist & Prognose“** öffnen.
3. Optional die **Suche** nutzen (Name, externe ID, interne Asset-ID).
4. Spalten **Aktuell**, **+15 Min**, **+60 Min**, **Trend** und **Modell-Basis** lesen — dort sehen Sie die **operative Prognose** und die Datengrundlage (Ride-Zeitreihe, Typ-Durchschnitt oder Park-Durchschnitt).
5. Über **Details** eine Zeile öffnen, um **Verlauf**, **Einflussfaktoren**, **Erklärbarkeit** und ggf. **Genauigkeit / Rückblick** zu sehen.

### Was Sie beachten sollten

- **„Aktuell“** kommt in der Regel zuerst aus dem **Live-Feed** (letzte Wartezeit-Meldungen), sonst aus gespeicherten Samples oder der Prognose-Baseline — die Oberfläche kennzeichnet, ob die Zahl vom **Adapter** oder vom **Sync-Snapshot** stammt.
- Wenn **keine Ride-Assets** oder **keine Prognosen** erscheinen: Park prüfen, externe ID, Berechtigungen und ob der **Feature Store** (5-Minuten-Snapshots) für diesen Park befüllt wird (Betrieb/Integration — nichts, was Sie im UI „reparieren“ können).

---

## 3. KI-Studio — Modelle & Training

**Menü:** KI → **KI-Studio** / **Modelle & Training** (Route `/ai-insights/studio`).

### Was Sie tun

1. **Park wählen**.
2. Register **„Überblick“** lesen (Hierarchie: konkretes Asset → Kategorie → Gesamtpark).
3. Register **„Datensätze“**: Trainingsdatenquelle wählen (**Sandbox** zum Ausprobieren oder **Feature Store** für echte Snapshot-Daten), Entitätstyp **RIDE**, bei Bedarf **ein konkretes Asset** wählen und **Statistik aktualisieren**.
4. Register **„Training“**: Zielvariable, Features und Algorithmus wählen bzw. **Auto** nutzen — dann **„Neues Training starten“** (bzw. englische Variante).
5. Register **„Modell-Registry“**: trainierte Versionen einsehen; eine Version über **Aktivieren** zur **aktiven** Version für Vorhersagen im Studio-Kontext machen (sofern Ihre Rolle das erlaubt).
6. Register **„Vorhersagen“**: Testeingaben für eine **manuelle** Vorhersage mit dem gewählten Modell.

### Wichtiger Hinweis

Das KI-Studio ist ein **experimenteller Trainings- und Vorschau-Raum**. Die dort trainierten Modelle sind **nicht automatisch** dieselbe Pipeline wie die **operative Wartezeit-Prognose** auf der Wartezeiten-Übersicht (ADR-Baseline dort). Ergebnisse **vergleichen** Sie bewusst mit der Live-Ansicht.

---

## 4. Diagnose — ML Feature Monitor

**Menü:** KI → **Feature monitor** / Diagnose (Route `/ai/ml/feature-monitor`).

### Was Sie tun

1. **Park wählen**.
2. Den **ML Feature Monitor** öffnen.
3. Nach Bedarf **Asset**, **Zeitraum** oder Filter setzen (je nach aufgebautem UI-Block).
4. **Kacheln und Tabellen** nutzen, um Datenqualität, Trace-Qualität, fehlende Features oder Abweichungen zu erkennen — ideal für **Analyse** und **Abstimmung mit der IT**, nicht für operative Tagessteuerung allein.

---

## 5. Typische Probleme und was Sie tun können

| Symptom | Was Sie prüfen / tun |
|--------|------------------------|
| Hinweis zu **fehlender ThemeParks-Park-ID** | Administrator:in bitten, Park-Stammdaten und Integration zu prüfen. |
| **Leere** Ride-Liste | Parkwechsel; ob für diesen Park **Ride-Assets** angelegt/synchronisiert sind. |
| **403 / nicht autorisiert** | Rolle und Berechtigungen; neu anmelden. |
| **Lange Ladezeiten** bei Statistik/Training | Weniger Assets im Filter, anderen Zeitpunkt, oder IT informieren (Datenmenge). |

---

## 6. Kurz-Checkliste „Prognosen nutzen“

- [ ] Eingeloggt  
- [ ] Richtiger **Park** gewählt  
- [ ] Menü **Wartezeiten — Ist & Prognose** geöffnet  
- [ ] Bei Bedarf **Details** je Fahrgeschäft geöffnet  
- [ ] Bei Abweichungen zur Realität **Administrator:in** oder **Daten-Team** einbinden  

---

*Stand: abgeleitet aus dem aktuellen Admin-Dashboard und der dokumentierten Forecast-Architektur. Technische Detailflüsse: `docs/validation/ai-prognosen-ride-grid-dataflow.md` und `docs/adr/0001-forecast-architecture.md`.*
