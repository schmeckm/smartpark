# Route and OpenAPI governance (Phase S.1)

Lightweight checks to catch **new** contract drift: invalid OpenAPI, undocumented routes, too many gaps, and **orphaned** documented operations.

## What runs in CI

After database migrate/seed and `npm test`, CI runs `npm run governance:ci` which chains four gates:

1. **`check:openapi-drift`** — runs:
   - **`validate:openapi:parse`** — Loads `src/openapi/openapi.yaml` with `yamljs`; fails on invalid YAML or a missing `openapi` / `paths` shell.
   - **`audit:routes`** — Regenerates `docs/generated/express-routes.inventory.json` and gap reports via `scripts/list-express-routes.mjs` (Express inventory + heuristic OpenAPI match).
   - **Inventory limits** — Fails if `documentedNotLiveCount` > **0** (OpenAPI operation with no matching live route) or if `missingFromOpenapiCount` > **`maxAllowedMissingRouteCount`** in `docs/governance/openapi-undocumented-routes-baseline.json` (currently **2**).
   - **`check-openapi-route-drift.mjs`** — Ensures every live route that is still “missing” from OpenAPI matches an entry in **`allowedMissingTemplateKeys`**. Any **new** undocumented template key fails the build.
2. **`check:route-duplicates`** (Phase QW6) — Counts (METHOD, path) pairs registered more than once across the live Express app. Fails if the count exceeds `docs/governance/express-route-duplicates-baseline.json` or if any duplicate is not on the baseline allowlist.
3. **`check:root-mount-baseline`** (Phase A5) — Walks every route whose `mountOrigin` is `src/app.js` and confirms its path is covered by `docs/governance/root-mount-routes-baseline.json` (`allowedPrefixes` + `policy.rootProbes`). Fails if any new prefix appears outside the baseline. Warns (without failing) when an allowed prefix has no matching live route — those baseline entries are safe to prune.
4. **`check:openapi-build`** (Phase A4) — Builds `src/openapi/openapi.yaml` in memory from `src/openapi/_src/` and structurally compares to the committed artifact. Fails on any drift (paths, ops per path, schemas, parameters, responses, security, tags).

Together, (1) and (3) enforce both a **numeric cap** on gaps and an **explicit allowlist** for the only accepted undocumented templates today (`GET /`, `GET /health`) plus a **prefix allowlist** for routes that intentionally bypass `v1Router`.

## Workflow: adding a new HTTP route

1. Implement the route in Express (`src/routes/v1/index.js`, `src/app.js`, or a mounted router).
2. **Prefer** adding the operation to OpenAPI in the same change.
   - Edit the relevant file under **`src/openapi/_src/`** (Phase A4) — paths live in `_src/paths/<family>.yaml`, schemas in `_src/components/schemas.yaml`, etc. **Do not** hand-edit the top-level `src/openapi/openapi.yaml`; it is a build artifact.
   - Run **`npm run build:openapi`** to regenerate `src/openapi/openapi.yaml` from `_src/`. Commit both.
3. Run locally: **`npm run check:openapi-drift`** (parse + route audit + drift gate) and **`npm run check:openapi-build`** (verifies `_src/` and the built artifact have not drifted).
4. If `audit:routes` shows your route as documented (`inOpenApi: yes` in the inventory), the allowlist step passes with no baseline edit.
5. Commit OpenAPI (`_src/` + rebuilt `openapi.yaml`) + route code together when possible.

## OpenAPI update expectations

- **Whenever you add or change an HTTP surface** that clients, proxies, or codegen rely on, update the appropriate `src/openapi/_src/` file (and rebuild) in the same PR unless the team explicitly treats the route as private and extends governance (allowlist / max count) with review. The top-level `src/openapi/openapi.yaml` is generated — never edit it directly.
- Path keys in the spec are under the **`servers`** URL (`/api/v1`); inventory paths for v1 routes are full `/api/v1/...`. Root **`GET /`** and **`GET /health`** are mounted without that prefix on `app`; the OpenAPI file documents `/api/v1/health` style probes, so the inventory still shows two “missing” templates until those root probes are modeled (e.g. extra `servers` entry) — that is why they are allowlisted and why **`maxAllowedMissingRouteCount`** is **2**.

Regenerate generated docs when touching routes or OpenAPI:

`npm run audit:routes`

## Known-gap (allowlist + cap) policy

- `docs/governance/openapi-undocumented-routes-baseline.json` holds:
  - **`allowedMissingTemplateKeys`** — coarse `METHOD path` keys (same normalization as the audit: `:id` / `{id}` → `{p}`) that may remain undocumented.
  - **`maxAllowedMissingRouteCount`** — upper bound on how many live routes may be missing from OpenAPI at once (must stay consistent with intentional gaps).
- CI fails if an undocumented key appears that is **not** in the allowlist, or if missing count **exceeds** the cap, or if **any** OpenAPI operation is orphaned vs the live app.
- When you document a previously missing route, **remove** its key from the allowlist and, if appropriate, **lower** `maxAllowedMissingRouteCount` in the same PR.
- Adding allowlist keys or raising the cap should be rare and reviewed.

## Local commands

| Command | Purpose |
|--------|---------|
| `npm run check:openapi-drift` | **Recommended** — parse, inventory, orphan/missing limits, allowlist (full S.1 gate) |
| `npm run validate:openapi:parse` | YAML parse + minimal structural check only |
| `npm run audit:routes` | Route inventory + OpenAPI gap markdown/JSON only |
| `npm run validate:openapi:route-drift` | Allowlist-only check (expects existing `docs/generated/express-routes.inventory.json`) |
| `npm run governance:ci` | Same as `check:openapi-drift` (CI parity) |

## Related artifacts

- `docs/generated/openapi-gap-report.md` — Human-readable gap summary.
- `docs/generated/express-routes.inventory.json` — Machine-readable inventory (including `inOpenApi`).
