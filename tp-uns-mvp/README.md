# TP-UNS MVP (Theme Park Unified Namespace)

Node.js + Express + MQTT + PostgreSQL backend implementing a configurable Theme Park Unified Namespace:

`tpuns/{parkSlug}/v1/{domain}/{assetSlug}/{metric}`

## Quick Start

1. Copy env:

```bash
cp .env.example .env
```

2. Install:

```bash
npm install
```

3. Start infra + backend:

```bash
docker compose up --build
```

4. API docs:

- [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

## Local Dev (without Docker backend)

Run DB + MQTT with docker compose, then:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

## Example MQTT test publish

```bash
curl -X POST http://localhost:3000/api/v1/mqtt/publish \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "tpuns/europapark/v1/rides/euro_mir/queue_time",
    "payload": {
      "ts": "2026-04-25T09:15:00+02:00",
      "source": "test-client",
      "value": 35,
      "unit": "min",
      "quality": "GOOD",
      "confidence": 0.95,
      "metadata": {}
    }
  }'
```
