#!/bin/sh
set -eu

print_step() {
  printf '\n[api-startup] %s\n' "$1"
}

print_step "Waiting for PostgreSQL (db:5432/smartpark)..."
node scripts/wait-for-postgres.js

print_step "Running migrations..."
npm run db:migrate

print_step "Running seeders..."
npm run db:seed

printf '\n[api-startup] Startup summary\n'
printf '[api-startup] API:      http://localhost:%s\n' "${PORT:-3000}"
printf '[api-startup] Health:   http://localhost:%s/api/v1/health\n' "${PORT:-3000}"
printf '[api-startup] Ready:    http://localhost:%s/api/v1/health/ready\n' "${PORT:-3000}"
printf '[api-startup] OpenAPI:  http://localhost:%s/api/docs\n' "${PORT:-3000}"
printf '[api-startup] MQTT URL: %s\n' "${MQTT_BROKER_URL:-mqtt://mqtt:1883}"

print_step "Launching API on http://localhost:3000 ..."
exec node server.js
