# ADR-0003: Signal Preview Service (post–Phase Q baseline)

- **Status:** Accepted  
- **Date:** 2026-05-06  
- **Related:** [ADR 0002 — Signal Preview Service](../../adr/0002-signal-preview-service.md) (canonical index entry under `docs/adr/`)

## Context

Phases A–Q introduced ride/asset **signal metadata** (extensions JSON), read-only HTTP surfaces, Add-on Board draft/custom-widget flows, ML Studio feature-draft persistence, and a **unified read path** for “what does this signal look like at runtime?” without duplicating UNS latest → canonical inbound → ride feature snapshot logic across services.

## Decision

**Signal Preview Service** (`src/services/signal-preview.service.js`) is the **shared read-only runtime resolution layer** for:

- Add-on Board custom widgets (draft preview and tile enrichment)  
- ML Studio feature drafts (eligibility validation against extensions)  
- future Green previews  
- future KPI projections  

It centralizes:

- **Signal metadata resolution** (normalized interpretation of extensions for a given entity + key)  
- **Eligibility status** (usage-specific gates: e.g. board vs ML vs green/generic)  
- **Latest value lookup** (same persistence chain as prior phases; no raw MQTT in admin handlers)  
- **Runtime preview shape** (normalized status + optional `signalPreview` DTO aligned with OpenAPI `SignalRuntimePreview`)

Callers remain explicit; the service does **not** subscribe to MQTT, run training, or push values to boards or ML pipelines.

## Consequences

- New preview or read-model behavior for signal-backed UIs should extend this module instead of re-implementing extension parsing or latest-value reads in feature services.  
- Contract changes to preview semantics require an ADR update (see also **ADR 0002** in `docs/adr/README.md`).  
- Legacy response fields (`resolved`, `latestValue`, `health` on Add-on Board APIs) remain the stable contract for existing clients; `signalPreview` stays **additive**.

## Explicit non-goals

- **No KPI engine** — no aggregation, targets, or operational KPI computation in this layer.  
- **No ML training** — no dataset materialization, model training, or scoring orchestration.  
- **No MQTT frontend subscription** — admin UI does not gain live MQTT streams from this decision.  
- **No signal registry approval workflow** — no new governance tables or approval state machines.  
- **No Green optimization** — no energy/throughput optimization or Green-specific business rules beyond what metadata already allows for future consumers.
