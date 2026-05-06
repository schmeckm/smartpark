# Source of truth — Smart Park OS (living document)

**Phase 1:** Clarifies ownership for refactor planning. **Not** a guarantee that all call sites already respect this matrix.

| Domain concept | Authoritative store / service | Conflicting or derived copies | Recommended action |
|----------------|------------------------------|--------------------------------|--------------------|
| Park (operations) | `parks` (+ platform settings) | Legacy demo data in `zones` | Treat `parks` as SoT; migrate off legacy where possible |
| Zone (operations) | `park_zones` | `zones` | Deprecate `zones` for new features |
| Ride / attraction (catalog) | `park_assets` + type-specific master (e.g. `ride_master_data`) | `rides`, MDM ride rows | Platform asset + master; MDM as extended MDM; legacy `rides` read-only/deprecate |
| Adapter configuration | `provider_adapter_configs`, installed adapter rows | YAML on disk (`adapter-install-config`) | DB + manifest merge; document merge order |
| Canonical inbound message | `canonical_inbound_messages` | `integration_event_logs`, NDJSON pipeline log | Canonical row = SoT for message lifecycle; logs for ops/debug only |
| Latest UNS live view | `uns_latest_state` / UNS services | Feature snapshots | Snapshots = ML/history; UNS = live protocol view |
| Wait time (ML / history) | `ride_feature_snapshots_5m`, `ride_wait_time_samples` | Legacy `rides.wait_time` | Prefer snapshots + samples for analytics |
| Incident (ops ticket) | `incidents` | SQDC safety events | Different products: link or document boundary |
| SQDC mood / safety / snapshots | `sqdc_*` tables | — | Keep; consume via SQDC services |
| Park-level feature vector | `park_feature_snapshots_5m` | — | SoT for 5m park aggregates |
| ML wait-time model (Phase 2 Node) | `ml_model_registry` | `ml_model_versions` (older AI line) | Document two lines or converge later |
| Board thresholds (Add-on) | `config/addon-board/*` + `platform_settings` | Env overrides | Resolver merges sources (see `addon-board-config.service.js`) |
| User / auth | `users`, `user_roles`, `refresh_tokens` | — | Keep |
| Audit | `audit_logs` | — | Keep |

## Shared read layer (Phase 1+)

**`OperationsFactsService`** (`src/services/operations/operations-facts.service.js`) is the **planned** shared read path for operational facts. Phase 1 exposes only a **non-breaking** helper (`getCurrentRideWaitsForPark` with fallbacks). Boards continue using their existing services until a later phase explicitly switches them.

## MVP / RC baseline — signal metadata & preview

**`SignalPreviewService`** (`src/services/signal-preview.service.js`) is the **authoritative read-only composition** for ride-master signal metadata plus optional latest UNS/registry-backed values and normalized status for Add-on Board and ML Studio. It does not own persistence and does not subscribe to MQTT from the admin tier.

Normative decision: [ADR 0002 — Signal Preview Service](../adr/0002-signal-preview-service.md).  
Architecture snapshot (compatibility, degradation, tooling): [mvp-rc-baseline-signal-metadata.md](mvp-rc-baseline-signal-metadata.md).

| Domain concept | Authoritative store / service | Conflicting or derived copies | Recommended action |
|----------------|------------------------------|--------------------------------|--------------------|
| Signal eligibility + preview status | Extension JSON on assets/MDM rides + `signal-preview.service.js` | Per-feature duplicate UNS lookups | Extend preview service; do not fork topic builders |
