# ML Studio — extension ML signal picker (Phase O) — manual QA

**Goal:** On **AI Insights → AI Studio → Datasets**, browse **ride master** or **platform asset** extension metadata for signals with **`enabled: true`** and **`mlEligible: true`**. Selection is **local draft only** (browser state); it does **not** change training feature lists, `ride_feature_snapshots_5m`, MQTT encoders, or Green KPI logic. **Phase Q:** persisted feature-draft **`PUT`** validation (`enabled` + `mlEligible`) is implemented in the shared **`signal-preview.service.js`** module on the API (no new HTTP contract for the picker).

**APIs (existing, no new backend):**

- `GET /api/v1/mdm/rides/:id/extensions` — when scope is **Ride master**
- `GET /api/v1/assets/:assetId/extensions` — when scope is **Platform asset**

**RBAC:** Same as extension read elsewhere (**`rides.read`**). AI Studio page uses **`ai` · `read`** for route access; users without ride extension read may see load errors from the picker.

## Preconditions

- Active park selected in the admin header.
- For **platform asset** path: in the same **Datasets** tab, choose **Specific asset** and an asset (same controls used for dataset stats).
- For **MDM ride** path: at least one ride in the park (list loads from `GET /api/v1/mdm/rides?parkId=…`).

## Checklist

1. Open **AI Insights → AI Studio** → tab **Datasets**.
2. Confirm the section **Extension ML feature candidates** appears when a park is active.
3. **Platform asset:** Select **Platform asset**, set entity type + **Specific asset** + an asset above. The **ML signal source** list should load; only **`enabled` + `mlEligible`** rows appear, grouped by domain.
4. **Ride master:** Select **Ride master**, pick an MDM ride. List should load from ride extensions; empty state if no ML-eligible signals.
5. Pick a radio: **Selected signal** shows the `signalKey`; reload page → draft is **not** persisted (expected).
6. Switch scope or asset/ride → selection clears (draft reset).
7. **Out of scope:** Training **Run** still uses catalog feature codes only; no automatic wiring from this picker.

8. **Phase P — Save and reload feature draft**  
   With **`ai.refresh`**, pick one or more ML-eligible signals and click **Save feature draft**. Expect success toast; **Saved on server** lists the same keys and an **Updated** time. Call **`GET /api/v1/ai/studio/feature-drafts?entityType=…&entityId=…&datasetScope=single_asset`** (park header) — response **`data`** matches. Reload the AI Studio page → same entity scope → keys reload from **GET** (picker checkboxes reflect saved draft).

9. **Phase P — Clear draft**  
   Uncheck all signals, **Save feature draft** again — **`selectedSignalKeys`** should persist as **`[]`**; UI shows empty list or **—** as appropriate.

10. **Phase P — Validation**  
   With REST client, **`PUT`** a **`signalKey`** not present on extensions → **400** `INVALID_ML_FEATURE_DRAFT`. **`PUT`** with a key that exists but **`mlEligible: false`** → **400**. Wrong **`entityId`** for park → **404**.

**Architecture:** [`docs/architecture/ride-master-extensions.md`](../architecture/ride-master-extensions.md) (Phases O–P).
