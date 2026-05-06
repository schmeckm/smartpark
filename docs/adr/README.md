# Architecture Decision Records (ADR)

Normative architecture notes for Smart Park OS. **Do not introduce parallel forecast pipelines** without a new ADR that supersedes or amends the existing decision.

**Signal Preview (Phase Q):** **[ADR 0002](0002-signal-preview-service.md)** is the **main RC baseline** note (detailed status contract, HTTP exposure, compatibility, and non-goals). **[ADR 0003](../architecture/adr/ADR-0003-signal-preview-service.md)** is a shorter **architecture-tree summary** of the same decision; it links back to ADR 0002. Prefer updating **0002** when changing preview semantics; keep **0003** in sync if the high-level decision text changes.

| ADR | Title | Status |
|-----|--------|--------|
| [0001](0001-forecast-architecture.md) | Forecast & ML feature architecture | Accepted |
| [0002](0002-signal-preview-service.md) | Signal Preview Service — shared read-only resolution (RC baseline) | Accepted |
| [0003](../architecture/adr/ADR-0003-signal-preview-service.md) | Signal Preview Service — architecture summary (post–Phase Q) | Accepted |

When changing ingestion, feature store, or forecast layering, update the ADR in the same PR or follow up immediately. When changing **signal preview** semantics (metadata gates, latest-value chain, or normalized status), update **ADR 0002** in the same change (and align **ADR 0003** if the summarized decision or consequences change).
