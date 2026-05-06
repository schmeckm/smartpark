FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY admin-dashboard/package.json admin-dashboard/package-lock.json* ./
RUN npm ci

COPY admin-dashboard/ ./

COPY admin-dashboard/docker-entrypoint-dev.sh /usr/local/bin/smart-park-frontend-entry.sh
RUN sed -i 's/\r$//' /usr/local/bin/smart-park-frontend-entry.sh \
  && chmod +x /usr/local/bin/smart-park-frontend-entry.sh

EXPOSE 5173

ENTRYPOINT ["sh", "/usr/local/bin/smart-park-frontend-entry.sh"]
