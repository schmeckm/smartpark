# Release notes summary — Signal metadata & preview (RC hardening)

**Target:** Smart Park OS MVP / release-candidate baseline (2026-05-06).  
**Scope:** Hardening and documentation only—no new product features, Green KPIs, ML training, Signal Discovery, UI redesign, or new database tables.

## Highlights

- **Single read-only preview layer** (`signal-preview.service.js`) for Add-on Board and ML Studio signal interpretation, with normalized status and optional `signalPreview` on existing JSON responses.
- **Backward-compatible** additive fields and `legacy.resolved` for board consumers that predate unified status.
- **RBAC unchanged** for affected routes: Add-on Board continues `rides`/`ops` permissions; MDM and platform asset extensions remain `rides` read/update.
- **Operational safety:** Latest-value lookup errors degrade to missing live data with structured status, not unhandled exceptions.

## Verification performed (automated)

| Check | Command / artifact | Result (this run) |
|-------|---------------------|-------------------|
| Backend unit + RBAC sync + route audit test | `npm test` | **225 passed**, 0 failed |
| Admin dashboard TypeScript | `npx vue-tsc -b --noEmit` (from `admin-dashboard/`) | **Exit 0** |
| Route inventory + OpenAPI template diff | `npm run audit:routes` | **328** routes; **118** live templates missing from OpenAPI (heuristic); **0** documented ops absent from app |

## Documentation added/updated

- ADR 0002 expanded to RC baseline (status contract, compatibility, non-goals).
- Architecture baseline: `docs/architecture/mvp-rc-baseline-signal-metadata.md`.
- Cross-reference in `docs/architecture/source-of-truth.md` (Signal preview row).

## Optional integration tests

HTTP integration tests under `src/integration-tests/ride-master-extensions/` require `RIDE_EXT_API_TESTS=1` and a running API + database; they are **not** part of default `npm test`.

## Upgrade notes for operators

- No migration required for preview semantics.
- Regenerate `docs/generated/*` after route or OpenAPI edits using `npm run audit:routes`.
