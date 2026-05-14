# Macro Tourism Index (`macro_tourism_index`)

Dieser Adapter liefert einen parkweiten Tourismus-Nachfrageindex als Feature `macro_tourism_index`.

Signalweg:

- Adapter pollt Upstream-API (optional) oder nutzt Fallback-Wert.
- Ausgabe als Observation (`MACRO_TOURISM_INDEX_OBSERVED`).
- Weiterleitung ueber Output-Profile (empfohlen: `SPARKPLUG_JSON`, `CANONICAL_HISTORIAN`).

## Konfiguration

Pflicht:

- `parkSlug`

Optional:

- `apiUrl` - Quelle fuer Indexwert
- `apiMethod` - `GET` oder `POST`
- `apiToken` - Bearer-Token
- `jsonPath` - Dot-Path zum Index im JSON (Default `data.index`)
- `defaultIndex` - Fallback bei API-Ausfall (Default `0.5`)
- `minIndex` / `maxIndex` - Clamping-Grenzen (Default `0..1`)
- `timezone`

## Erwartete API-Antwort (Beispiel)

```json
{
  "data": {
    "index": 0.73
  }
}
```

Mit `jsonPath = "data.index"` wird `0.73` gelesen.

## Ergebnis

Pro Lauf wird mindestens eine Observation erzeugt:

- `domain`: `demand`
- `assetSlug`: `macro`
- `metric`: `macro_tourism_index`
- `value`: `[minIndex..maxIndex]` geclamped

Wenn die API ausfaellt, nutzt der Adapter den Fallback-Wert und markiert `quality=ESTIMATED`.
