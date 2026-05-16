# syntax=docker/dockerfile:1
#
# Build context: repository root (`.`).
#   docker compose build frontend          → target `development` (Vite dev server)
#   docker build -f admin-dashboard/Dockerfile --target production .

# ─── Development (local docker-compose.yml) ───────────────────────────────────
FROM node:22-alpine AS development

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY admin-dashboard/package.json admin-dashboard/package-lock.json* ./
RUN npm ci

COPY src/utils/signal-availability-resolver.mjs src/utils/uns-mqtt-live-signal-match.mjs ./monorepo-src-utils/
COPY admin-dashboard/ ./

COPY admin-dashboard/docker-entrypoint-dev.sh /usr/local/bin/smart-park-frontend-entry.sh
RUN sed -i 's/\r$//' /usr/local/bin/smart-park-frontend-entry.sh \
  && chmod +x /usr/local/bin/smart-park-frontend-entry.sh

EXPOSE 5173

ENTRYPOINT ["sh", "/usr/local/bin/smart-park-frontend-entry.sh"]

# ─── Production build (static assets) ─────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /repo

RUN apk add --no-cache libc6-compat

# Monorepo root (`smart-park-os`: file:..) + vite parent `shared/rbac.json`
COPY package.json package-lock.json* ./
COPY shared ./shared
COPY admin-dashboard/package.json admin-dashboard/package-lock.json* ./admin-dashboard/

WORKDIR /repo/admin-dashboard
RUN npm ci

COPY src/utils/signal-availability-resolver.mjs src/utils/uns-mqtt-live-signal-match.mjs ./monorepo-src-utils/
COPY admin-dashboard/ ./

ARG GIT_COMMIT=
ENV GIT_COMMIT=${GIT_COMMIT}

# `build:prod` runs Vite only (faster, no vue-tsc gate). Local quality: `npm run build` in admin-dashboard.
RUN npm run build:prod

# ─── Production runtime (nginx) ───────────────────────────────────────────────
FROM nginx:1.27-alpine AS production

COPY admin-dashboard/nginx.prod.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-builder /repo/admin-dashboard/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
