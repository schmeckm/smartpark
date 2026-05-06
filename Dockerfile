FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Strip Windows CRLF so `set -eu` works under Alpine `sh` (build context may be checked out with CRLF).
RUN sed -i 's/\r$//' docker/entrypoint.sh && chmod +x docker/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["sh", "./docker/entrypoint.sh"]
