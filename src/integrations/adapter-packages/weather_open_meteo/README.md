# Open-Meteo Weather (`weather_open_meteo`)

Dieser Adapter holt Wetterdaten fuer einen Park ueber [Open-Meteo](https://open-meteo.com/) (ohne API-Key) und schreibt sie als normalisierte Observations weiter.

Er ist gedacht fuer:

- Live- und Historian-Pipelines (`SPARKPLUG_JSON`, `CANONICAL_HISTORIAN`)
- UNS/TPUNS-Streams (optional)
- nachgelagerte Analytics/ML Features

## Was sehe ich als Anwender?

Jeder Run erzeugt `WEATHER_OBSERVED`-Events mit u. a.:

- `temperature`
- `rain_probability`
- `rain_mm`
- `wind_speed`
- `weather_condition`

Domain ist `weather`, Asset ist `current` (eine Wetterstation pro Park).

## Schnellstart (empfohlen)

1. Integration installieren.
2. `parkSlug`, `latitude`, `longitude` setzen.
3. `outputProfiles` auf `["SPARKPLUG_JSON","CANONICAL_HISTORIAN"]` lassen.
4. Test mit "Run now".
5. Danach in Operations Center / Pipeline Tail pruefen, ob Events ankommen.

## Felder erklaert (`configSchema`)

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `parkSlug` | ja | Park-Schluessel in den Daten. Sollte zu UNS/`sparkplugGroupId` passen (z. B. `europa_park`). |
| `latitude` | ja | Breitengrad des Parks (Zentrum). |
| `longitude` | ja | Laengengrad des Parks (Zentrum). |
| `timezone` | nein | IANA-Zeitzone fuer Open-Meteo, Standard `Europe/Berlin`. |

Hinweis: Nutze Park-Koordinaten (nicht einzelne Rides), damit Forecast und aktuelle Werte konsistent bleiben.

## Context-Felder erklaert (`contextJson`)

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `sparkplugGroupId` | empfohlen | Group im Sparkplug-Topic, z. B. `europa_park`. |
| `sparkplugEdgeNode` | empfohlen | Node im Sparkplug-Topic, Standard oft `weather_gateway`. |
| `parkSlug` | optional | Fallback fuer TPUNS/UNS-Pfade, wenn noetig. |

Beispiel:

```json
{
  "parkSlug": "europapark",
  "sparkplugGroupId": "europa_park",
  "sparkplugEdgeNode": "weather_gateway"
}
```

## Outputs und Topics

- **Empfohlenes Profil:** `["SPARKPLUG_JSON","CANONICAL_HISTORIAN"]`
- **Sparkplug Topic:** `spBv1.0/{sparkplugGroupId}/DDATA/{sparkplugEdgeNode}/current`
- **Optional TPUNS Topic:** `tpuns/{parkSlug}/v1/weather/current/{metric}`

## Warum sehe ich Daten in UNS Live, auch wenn MQTT aus ist?

Der UNS-Live-Puffer wird serverseitig aus Adapter-Publishes gefuellt. Deshalb kann ein Preview/Run auch sichtbar sein, wenn:

- `MQTT_ENABLED=false` ist, oder
- der Broker gerade nicht erreichbar ist.

Das ist normal und hilft beim Testen.

## MQTT in Docker richtig konfigurieren

Fuer echtes Broker-Publishing brauchst du:

- `MQTT_ENABLED=true`
- gueltige `MQTT_BROKER_URL`

In Docker Compose ist die URL meist:

- `mqtt://mqtt:1883` (Service-Name im Netzwerk)

Nicht `127.0.0.1` im Container verwenden (zeigt auf den Container selbst).
Von deinem Host kannst du z. B. mit MQTT Explorer auf `localhost:1883` subscriben (falls Port gemappt).

## UI-Defaults aus `manifest.json`

Beim Anlegen werden Starter-Werte aus dem Manifest gemerged:

- `configSchema.properties.*.default` (z. B. `parkSlug`, Koordinaten, `timezone`)
- `defaultContextJson` (z. B. `sparkplugGroupId`, `sparkplugEdgeNode`)
- `defaultScheduleCron` (`*/10 * * * *`, falls kein Cron gesetzt)

## Scheduler-Hinweis (Koordinatenquelle)

Der Scheduler nutzt Koordinaten in dieser Reihenfolge:

1. `parks.latitude/longitude`
2. `park_assets` vom Typ PARK
3. diese Install-Config (`configJson`/`contextJson`) in `data/adapter-install-config/weather_open_meteo.install.yaml`

`WEATHER_OPEN_METEO_ENABLED` schaltet den Scheduler nur an/aus und speichert keine Koordinaten.

## Fehlerbilder & Loesung

### 1) Keine Daten im Operations Center

Pruefen:

- Adapter ist installiert und aktiviert.
- `latitude`/`longitude` sind gesetzt.
- Run preview / run now zeigt erfolgreiche Steps.
- Zeitfenster im Dashboard ist passend.

### 2) Daten kommen, aber im falschen Park-Kontext

Pruefen:

- `parkSlug` in `configJson`
- `sparkplugGroupId` in `contextJson`
- Integrations-`unsParkKey`

Diese Werte sollten logisch zusammenpassen (z. B. `europa_park`).

### 3) MQTT Explorer zeigt nichts

Pruefen:

- `MQTT_ENABLED=true`
- korrekte `MQTT_BROKER_URL`
- in Docker meist `mqtt://mqtt:1883` (nicht `127.0.0.1` im Container)
- Host-Subscribe auf `localhost:1883` nur wenn Port gemappt ist