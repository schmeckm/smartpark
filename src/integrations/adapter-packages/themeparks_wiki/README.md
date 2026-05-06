# ThemeParks.wiki adapter

This package wraps the public [ThemeParks.wiki](https://themeparks.wiki) HTTP API for Smart Park OS.

## Configuration

- **`parkId`** (optional in `configJson`): ThemeParks.wiki **park entity UUID** for `GET /v1/entity/{parkId}/children` and `/live`. If you omit it, the adapter uses the park from **Admin → Integration settings → Destination / park selection** (saved as `externalParkData.selectedPark` when provider is `themeparks_wiki` — same `externalParkId` as in the dropdown). You can still set `parkId` here to override that selection (e.g. second park for tests). UUIDs are listed under `destinations[].parks[].id` in [GET /v1/destinations](https://api.themeparks.wiki/v1/destinations).

## Capabilities

- Discovery of entities for a park
- Polling live queue times and status
- UNS / canonical pipeline outputs (when enabled in installation settings)

## Assets

- `assets/logo.svg` — integration icon
- `assets/banner.svg` — wide banner for the admin UI (optional; `banner.png` is also supported if present)
