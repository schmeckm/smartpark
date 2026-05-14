# Wartezeiten.APP adapter (`wartezeiten_app`)

This adapter imports wait-time data from [Wartezeiten.APP](https://wartezeiten.app) into Smart Park OS.

It is useful when you want a simple external queue-time feed for operations dashboards and downstream analytics.

## What you get

The adapter publishes ride wait-time observations with:

- domain: `rides`
- metric: `queue_time`
- unit: minutes

## Configuration (`configJson`)

| Field | Required | Meaning |
|---|---|---|
| `parkId` | no | Optional park scoping, if your deployment/provider mapping supports it. |

If `parkId` is empty, behavior depends on provider-side defaults and your integration setup.

## Quick start

1. Install the adapter in Devices and Services.
2. Optionally set `parkId` (only if you need a fixed park scope).
3. Run preview / run now.
4. Verify queue-time events in Operations Center and pipeline tail.

## Recommended operations checks

- Validate that events arrive with the expected park context.
- Confirm queue values are plausible (no flatline/noise spikes).
- If data is empty, check provider-side park mapping and credentials/network path.

## Fehlerbilder & Loesung

### 1) Keine Queue-Daten

Pruefen:

- Adapter aktiv und Run wurde ausgefuehrt
- Provider-Zugang/Netzwerk in Ordnung
- optionales `parkId` korrekt (oder testweise entfernen)

### 2) Daten fuer falschen Park

Pruefen:

- `parkId` in `configJson`
- Integrationskontext (`parkSlug`/unsParkKey) passt zur Instanz

### 3) Werte wirken unplausibel

Pruefen:

- Abgleich mit externer Quelle (Wartezeiten.APP) im selben Zeitraum
- Scheduler-Intervall und Zeitfenster im Dashboard
- Ausreisser als Provider-Signal vs. Mapping-Fehler bewerten
