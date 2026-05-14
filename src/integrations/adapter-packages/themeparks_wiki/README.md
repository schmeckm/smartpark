# ThemeParks.wiki adapter (`themeparks_wiki`)

This adapter connects Smart Park OS to the public [ThemeParks.wiki](https://themeparks.wiki) API.

Use it to import park entities and live operational data (queues/status), then forward into your platform pipelines.

## What this adapter does

- fetches park structure (entities/children)
- fetches live park data (wait times, status, observations where available)
- sends normalized events into UNS/canonical/Sparkplug outputs (depending on install settings)

## Park selection logic

You can select the park in two ways:

1. **UI selection (recommended):** Integration settings -> destination/park select
2. **`configJson.parkId` override:** forces a specific ThemeParks park UUID

If `parkId` is omitted, the adapter uses the park selected in integration settings.

## Configuration (`configJson`)

| Field | Required | Meaning |
|---|---|---|
| `parkId` | no | ThemeParks park UUID for `/entity/{parkId}/children` and `/entity/{parkId}/live`. Overrides UI park selection when set. |

Where to find IDs:

- [GET /v1/destinations](https://api.themeparks.wiki/v1/destinations) -> `destinations[].parks[].id`

## Quick start

1. Install adapter in Devices and Services.
2. Choose destination/park in the integration UI.
3. Leave `parkId` empty unless you need an explicit override.
4. Run preview / run now and validate events in Operations Center.

## Typical use cases

- queue time ingestion for ride operations
- park master data enrichment
- baseline features for analytics/forecasting

## Notes

- Public API behavior/rate may vary by destination.
- If you run multiple installs, ensure each one has a clear park assignment to avoid mixed streams.

## Package assets

- `assets/logo.svg` -> integration icon
- `assets/banner.svg` -> optional wide banner in admin UI (`banner.png` is also supported)

## Fehlerbilder & Loesung

### 1) Keine Live-Daten

Pruefen:

- korrekter Park in Integration Settings ausgewaehlt
- optionales `configJson.parkId` zeigt auf gueltige ThemeParks UUID
- API/Netzwerk erreichbar

### 2) Falscher Park erscheint

Pruefen:

- ist `parkId` als Override gesetzt?
- passt die UI-Auswahl zum erwarteten Park?
- laufen mehrere Instanzen mit unterschiedlicher Park-Zuordnung?

### 3) Daten kommen unvollstaendig

Pruefen:

- manche Destinationen liefern weniger Felder als andere (providerseitig normal)
- Run preview / pipeline logs auf API-Fehler oder Mapping-Hinweise checken
