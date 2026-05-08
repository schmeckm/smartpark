# archive/

Frozen artifacts that are intentionally kept in the repository as historical
context but are **not part of the active build, tests, lint, or runtime**.

Nothing under this directory is imported by `src/`, exercised by `npm test`,
linted by `npm run lint`, or shipped by any deploy. Anything that needs to be
revived must be moved out of `archive/` and re-integrated explicitly.

## Contents

### `tp-uns-mvp/` — TP-UNS MVP lab tree (archived 2026-05-07, QW9)

A standalone Node.js / Express / Sequelize / MQTT app that prototyped the
Smart Park UNS topic shape (`tpuns/{park}/v1/{domain}/{asset}/{metric}`) on a
separate Postgres + Mosquitto stack via its own `docker-compose.yml`.

- **Why it was archived:** the production codebase under `src/` already
  implements a superset of its concepts — UNS topic generation
  (`src/modules/uns/uns-topic-generator.service.js`), canonical event
  ingestion (`src/services/canonical-message-apply.service.js`), the live
  `uns_latest_states` buffer (`src/services/registry-publisher.service.js`,
  `src/services/registry-preview.service.js`), MQTT subscription
  (`src/services/mqtt-connector.service.js`), and the UNS REST surface
  (`src/modules/uns/uns.service.js`). The lab tree is no longer the source
  of truth and is not deployed.
- **Why it was kept (not deleted):** the README, migrations, seeders, and
  topic regex still document the original conceptual model and are useful
  reference material for anyone reasoning about the canonical topic shape
  or the original MVP scope.
- **What still references it:** nothing in `src/`, `scripts/`, or CI. The
  `tpuns/` topic *prefix* used throughout production code is unrelated to
  this directory — it is the canonical UNS namespace, defined in
  `src/modules/uns/topic-layout/topic-layout.v2.js`.

If you find yourself wanting to read code in `archive/tp-uns-mvp/`, prefer
the production equivalents listed above.
