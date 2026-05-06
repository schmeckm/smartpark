#!/bin/sh
set -eu

node scripts/wait-for-postgres.js
npm run db:migrate
npm run db:seed
exec node server.js