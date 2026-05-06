# Phase 13 — MQTT Capability Enforcement Guard

This phase adds a guarded, feature-flagged evaluation path for inbound MQTT messages while preserving legacy behavior unless explicitly enabled.

## Feature flags

- `MQTT_CAPABILITY_GUARD_MODE=off|warn_only|enforce`
  - default: `off`
  - `warn_only`: evaluate + persist decision, never block runtime processing
  - `enforce`: block non-approved inbound `tpuns/...` and `spBv1.0/...` messages
- `MQTT_CAPABILITY_GUARD_ALLOWED_RIDE_IDS=<csv UUIDs>`
  - optional pilot scope; if set, only listed rides are enforced strictly

## Scope and safety

- Guard evaluation applies only to inbound topics starting with `tpuns/` and `spBv1.0/`.
- Guard failures are wrapped and downgraded safely (`decision=SKIP`); connector continues.
- `off` mode keeps processing behavior unchanged.
- No ThemeParks sync logic changes.
- No registry publisher behavior changes.
- No `uns_nodes` writer behavior changes.
- No dashboard logic changes.

## Decision contract

`evaluateInboundMqttCapability({ topic, payloadJson, receivedAt })` returns:

- `mode`
- `decision`: `ALLOW | WARN | BLOCK | SKIP`
- `reason`
- `topic`
- `rideAssetId`
- `signalKey`
- `registryTopicId`
- `capabilitySource`
- `details`

Approval checks:

1. Topic is mappable to ride + signal.
2. Active prepared registry topic exists in `uns_registry_topics`:
   - `registry_source = PREPARED_OPERATOR`
   - `is_active = true`
3. Capability row exists in `ride_signal_capabilities` for mapped ride/signal, and:
   - `signalSource != NOT_AVAILABLE`
   - for MQTT guard path: `signalSource === MQTT_EDGE`

## Persistence

`mqtt_inbound_messages` now includes additive nullable fields:

- `capability_guard_mode`
- `capability_guard_decision`
- `capability_guard_reason`
- `capability_guard_details` (JSONB)

## Runtime behavior by mode

- `off`
  - returns `SKIP`
  - existing flow unchanged
- `warn_only`
  - non-approved topics become `WARN`
  - existing ingestion/upsert continues
- `enforce`
  - `BLOCK` prevents legacy ingestion/upsert for that message
  - blocked message creates UNS Spy event (`CAPABILITY_GUARD_BLOCK`)
  - warning log is emitted

## APIs

- `GET /api/v1/mqtt/capability-guard/status`
  - returns `mode`, `allowedRideCount`, `lastBlockedAt`, `blockedLast24h`, `warnedLast24h`, `allowedLast24h`
- `GET /api/v1/mqtt/inbound?capabilityDecision=BLOCK|WARN|ALLOW|SKIP`
  - filters inbound rows by guard decision

Permissions for both routes:

- `integrations.read` OR `rides.read`

## Manual validation checklist

1. `off` mode:
   - send `tpuns` and `spBv1.0` messages
   - confirm legacy behavior unchanged
   - verify inbound rows persist `capability_guard_decision=SKIP` for scoped topics
2. `warn_only` mode:
   - send unknown topic/signal
   - verify `WARN` in inbound rows
   - confirm tpuns messages still update `uns_latest_states`
3. `enforce` mode:
   - send unknown/unapproved topic
   - verify inbound row marked `BLOCK`
   - verify no state upsert for blocked tpuns message
   - verify UNS Spy event with `CAPABILITY_GUARD_BLOCK`
4. pilot allow-list:
   - set one ride in `MQTT_CAPABILITY_GUARD_ALLOWED_RIDE_IDS`
   - verify only listed ride is enforced; non-listed rides pass through
