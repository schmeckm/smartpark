# Traffic corridors & attendance risk (MVP)

Manual **traffic corridors** and **5-minute snapshots** feed a park-level **attendance risk forecast**. Traffic is a **leading indicator** only: it influences external demand pressure and probabilistic attendance bands; it is not mapped 1:1 to visitor counts.

- **UI:** Operations → **Traffic corridors** (`/operations/traffic-corridors`); Operations dashboard card **Attendance risk forecast**.
- **API:** OpenAPI tag `AttendanceRisk` — list/create corridors per park, PATCH/DELETE corridor by id, POST manual snapshot, POST run forecast, GET latest/history.
- **Demo seed:** Migration `20260514150000-traffic-corridors-europa-demo-seed.js` inserts two example corridors when a `parks` row matches Europa-style slug/name; skipped if no park. Rows use `source = 'europa_demo_seed'` for idempotent cleanup.
- **Example JSON bodies:** `traffic-corridors-manual-snapshots.example.json` in this folder.
