#!/bin/sh
set -e
cd /app

# Named volume `frontend_node_modules` can hold a stale tree after package.json / lock changes.
# Re-run npm ci when the lockfile (or this script) is newer than our stamp inside node_modules.
STAMP=node_modules/.smartpark_deps_stamp
need_ci=0
if [ ! -f node_modules/vite/package.json ]; then
  need_ci=1
elif [ ! -f "$STAMP" ]; then
  need_ci=1
elif [ package-lock.json -nt "$STAMP" ] 2>/dev/null; then
  need_ci=1
elif [ package.json -nt "$STAMP" ] 2>/dev/null; then
  need_ci=1
elif [ ! -f node_modules/vue-i18n/package.json ]; then
  # Stale volume: lock mtime checks can miss partial/outdated trees across bind-mount + volume.
  need_ci=1
elif [ ! -f node_modules/echarts/package.json ]; then
  # e.g. added to package.json after volume was created — refresh deps.
  need_ci=1
elif [ ! -f node_modules/leaflet.heat/package.json ] || [ ! -f node_modules/leaflet.heat/dist/leaflet-heat.js ]; then
  need_ci=1
fi

if [ "$need_ci" = 1 ]; then
  echo "[frontend] Installing dependencies (npm ci)..."
  npm ci
  touch "$STAMP"
fi

exec npm run dev -- --host 0.0.0.0 --port 5173
