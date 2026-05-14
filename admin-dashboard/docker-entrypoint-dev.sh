#!/bin/sh
set -e
cd /app

log_step() {
  printf '\n[frontend-startup] %s\n' "$1"
}

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
elif [ ! -f node_modules/lucide-vue-next/package.json ]; then
  need_ci=1
elif [ ! -f node_modules/leaflet.heat/package.json ] || [ ! -f node_modules/leaflet.heat/dist/leaflet-heat.js ]; then
  need_ci=1
fi

if [ "$need_ci" = 1 ]; then
  log_step "Installing dependencies (npm ci)..."
  npm ci
  touch "$STAMP"
fi

API_READY_URL="${API_READY_URL:-http://api:3000/api/v1/health/ready}"
MAX_WAIT_SECONDS="${API_READY_WAIT_SECONDS:-45}"
SLEEP_SECONDS=1
ELAPSED=0

log_step "Waiting for API readiness (${API_READY_URL}) ..."
while ! wget -q -T 1 -O /dev/null "$API_READY_URL"; do
  if [ "$ELAPSED" -ge "$MAX_WAIT_SECONDS" ]; then
    log_step "API not ready after ${MAX_WAIT_SECONDS}s, starting Vite anyway."
    break
  fi
  sleep "$SLEEP_SECONDS"
  ELAPSED=$((ELAPSED + SLEEP_SECONDS))
done

printf '\n[frontend-startup] Startup summary\n'
printf '[frontend-startup] Frontend: %s\n' "http://localhost:5173"
printf '[frontend-startup] API proxy: %s\n' "${VITE_PROXY_API_TARGET:-http://api:3000}"
printf '[frontend-startup] API ready: %s\n' "$API_READY_URL"

log_step "Starting Vite dev server on http://localhost:5173 ..."
exec npm run dev -- --host 0.0.0.0 --port 5173
