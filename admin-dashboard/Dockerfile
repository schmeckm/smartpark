FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY admin-dashboard/package.json admin-dashboard/package-lock.json* ./
RUN npm ci

# Bundled root utilities for `vite.config.ts` `@smartpark-root-utils/*` (same files compose mounts at `/app/monorepo-src-utils`).
COPY src/utils/signal-availability-resolver.mjs src/utils/uns-mqtt-live-signal-match.mjs ./monorepo-src-utils/

COPY admin-dashboard/ ./

COPY admin-dashboard/docker-entrypoint-dev.sh /usr/local/bin/smart-park-frontend-entry.sh
RUN sed -i 's/\r$//' /usr/local/bin/smart-park-frontend-entry.sh \
  && chmod +x /usr/local/bin/smart-park-frontend-entry.sh

EXPOSE 5173

ENTRYPOINT ["sh", "/usr/local/bin/smart-park-frontend-entry.sh"]
