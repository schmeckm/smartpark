# traffic_corridors

Feature-gate adapter for **Traffic corridors** (manual corridor CRUD + snapshots + attendance risk forecast UI).

- **Install** via Devices & Services (or `POST /integrations/installed-adapters/install-local`).
- **Runtime**: `poll` is intentionally a **no-op** until a real traffic provider is integrated; the admin UI and REST routes work independently.
