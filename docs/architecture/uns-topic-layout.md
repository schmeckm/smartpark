# UNS topic layout (Phase A)

This note describes the **topic-layout** module under `src/modules/uns/topic-layout/`. It is additive: existing MQTT encoders and `uns-validator.service.js` behavior remain the default elsewhere until callers opt in.

## Layouts

### v1 (legacy, current production shape)

```text
tpuns/{parkSlug}/v1/{domain}/{assetSlug}/{metric}
```

- Six path segments after splitting on `/` (including `tpuns`).
- Segment grammar matches the historical UNS validator: lowercase letters, digits, underscores.
- **Normalized identity:** `layout: "v1"`, `level: null` (no level segment in legacy paths).
- **signalKey:** `{domain}.{metric}` (literal segment values, not slugified).

Example:

```text
tpuns/europa_park/v1/entities/blue_fire/queue_time
```

### v2 (target, future-ready)

```text
tpuns/{parkSlug}/v1/{level}/{assetSlug}/{domain}/{metric}
```

- Seven path segments.
- **level** must be one of: `park`, `zones`, `rides`.
- **domain** must be one of: `operations`, `queue`, `green`, `maintenance`, `weather`, `guestflow`, `staffing`, `safety`.
- **signalKey:** `{domain}.{metric}`.

Examples:

```text
tpuns/europa_park/v1/rides/blue_fire/queue/wait_time_min
tpuns/europa_park/v1/rides/blue_fire/green/power_kw
```

## API (module)

- `parseAny(topic)` — returns normalized identity or throws `AppError` with `422` / `INVALID_TOPIC_*`.
- `buildV1(identity)` — `{ parkSlug, domain, assetSlug, metric, version? }` → v1 path (slugified via existing `slugifyName`).
- `buildV2(identity)` — `{ parkSlug, level, assetSlug, domain, metric, version? }` → v2 path.
- `detectLayout(topic)` — `'v1' | 'v2' | null` without throwing.

## Disambiguation rule

- If the path has **seven** segments and the segment after `v1` is a **known v2 level**, it is treated as **v2**.
- If the path has **six** segments and matches the v1 regex, it is treated as **v1**.
- Otherwise parsing fails (`INVALID_TOPIC_LAYOUT`).

## Constants

Authoritative lists live in `topic-layout.constants.js` (`SUPPORTED_DOMAINS`, `SUPPORTED_LEVELS`). The v2 path regex is derived from those arrays to avoid drift.

## Integration stance (Phase A)

- **Do not** switch encoders or ingestion to v2 by default.
- New code may import `topic-layout.resolve` for dual read/build support during later phases.
