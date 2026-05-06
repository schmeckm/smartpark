# Add-on Board — Signal source picker, draft, preview & custom widgets (Phases F–N) — manual QA

**Phase F:** the picker reads **`GET /api/v1/assets/:assetId/extensions`**. **Phase G:** **Save as widget source** persists a draft via **`PUT /api/v1/addon-board/rides/:rideId/widget-source-draft`**. **Phase H:** **`GET`** the same path returns **`{ draft, resolved }`** for a read-only **preview tile** (valid/invalid vs current extensions). **Phase I:** the same **`GET`** adds **`latestValue`** (read-only scalar from persisted UNS / canonical / snapshot when **`resolved.valid`**; **`null`** otherwise). **Phase J:** **`POST /api/v1/addon-board/rides/:rideId/widgets/from-source-draft`** ( **`rides.update`** ) promotes a **valid** draft into **`park_assets.master_profile.addonBoardCustomWidgets`**; **`GET .../custom-widgets`** lists them. **Phase K:** the same **`GET .../custom-widgets`** enriches each enabled **`SIGNAL_METADATA` + `latest_value`** row with **`resolved`** and **`latestValue`** (same read path as Phase I); L3 shows **read-only tiles**. **Phase L:** **`PATCH`** / **`DELETE`** **`/api/v1/addon-board/rides/:rideId/custom-widgets/:widgetId`** — rename, enable/disable, remove ( **`rides.update`** ); **`source`** / **`display`** not editable via API. **Phase M:** each **`GET`/`PATCH`** widget row includes derived **`health`** (`ok`, `invalid_source`, `disabled`, `no_live_value`, `entity_mismatch`); UI shows a **summary strip** and **badges**. **Phase N:** stable **custom signal widgets** copy, in-panel help + approved-metadata banner; **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER`** documented as a **rollback** switch (not an experiment flag). **Phase Q (consolidation):** draft **`GET`** and custom-widget payloads may include optional additive **`signalPreview`** (normalized status + eligibility); UI behavior is unchanged if the field is ignored. Nothing here changes template board KPI math, browser MQTT subscriptions, or ML/Green automation.

**Architecture:** [`docs/architecture/ride-master-extensions.md`](../architecture/ride-master-extensions.md) (Phases F–N).

## Preconditions

- API + admin-dashboard dev (or preview) with **`rides.read`** (picker + GET draft) and **`rides.update`** (PUT draft / save button).
- At least one **platform ride asset** in the park with extension metadata containing a signal where **`enabled: true`** and **`boardEligible: true`** (configure via ride master extensions / Phase E on that **`park_assets.asset_id`**).

## Manual checklist

1. **Enable the UI (rollback switch on)**  
   In `admin-dashboard/.env` (or env used by Vite):  
   `VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER=true`  
   Restart the dev server so the bundle includes the flag. This is a **build-time rollback** for the L3 block only; turning it off later hides the UI without deleting stored drafts or widgets.

2. **Configure one board-eligible signal**  
   On a **`park_asset`** used as a ride on the board, set at least one signal (e.g. `queue.wait_time_min`) with **`enabled`** and **`boardEligible`** true in extensions (same shape as ride master extensions).

3. **Open Add-on Board L3**  
   **Operations → Add-on Board →** tab **Ride (L3)**. Select an active park in the header if prompted.

4. **Select the ride**  
   Use the ride dropdown so it matches the asset you configured.

5. **Verify grouped signals**  
   The **Custom signal widgets** panel shows **Board signal source** (picker title); eligible signals appear **grouped by domain** (or the empty copy if none qualify). Confirm the subtle banner about **approved signal metadata** is visible.

6. **Select one signal**  
   Choose a radio; **Selected source:** shows the `signalKey`.

7. **Phase G — Save and reload**  
   Click **Save as widget source**. Expect success toast. Reload the page (or use **Refresh**), open L3 and the same ride again: the **Widget source (saved draft)** preview tile must still show the same `signalKey`. Changing ride clears only the **unsaved** radio selection; returning to the first ride must still show the preview until you overwrite with another save.

8. **Phase H — Preview validity**  
   With a saved draft visible, the preview shows **Status: Valid** when extensions still have **`enabled`** and **`boardEligible`** for that key. In ride master extensions (or PATCH), turn **`boardEligible`** or **`enabled`** off for that signal (or remove the signal), reload L3: preview should show **Invalid** and **“Saved source is no longer eligible.”** Restore flags and reload → **Valid** again.

9. **Phase I — Live preview (read-only)**  
   When status is **Valid**, the tile shows **Live preview (read-only)**: either a scalar (with source / quality / timestamp when returned by the API) or **“No live value available yet.”** if the backend has no matching persisted row. After invalidating the draft (step 8), the live block must **not** appear until **Valid** again.

10. **API errors (manual or REST client)**  
   - Unknown `rideId` for the park → **404** `ASSET_NOT_FOUND`.  
   - `signalKey` not **enabled** + **boardEligible** on that asset → **400** `INVALID_WIDGET_SOURCE`.  
   - Body `entityId` not equal path `rideId` → **400**.

11. **Change ride (picker only)**  
   Pick another ride in the dropdown. The **Selected source** (unsaved) line must **clear**; the other ride may show its own saved draft if present.

12. **Disable the flag**  
   Set `VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER=false` (or remove it), restart Vite.

13. **Verify picker disappears**  
   Repeat steps 3–4: the **custom signal widgets** panel (picker + banner) must **not** render (saved draft preview and tiles are hidden too; data remains in DB).

14. **Phase J — Promote and list**  
   With **Valid** preview and **`rides.update`**, click **Promote to board widget**. Expect success toast; **Custom widgets** shows **tiles** (`widgetId`, title, live value or **“No live value available yet.”**). Reload L3: tiles persist. Call **`GET .../custom-widgets`** in a REST client with the same park header — each widget includes **`resolved`** / **`latestValue`** when enabled and `latest_value` (same shape as Phase I). With no draft, **`POST`** must return **400** `DRAFT_MISSING`. Turn the signal invalid (step 8) and try **POST** again → **400** `DRAFT_NOT_VALID`.

15. **Phase K — Tile warnings**  
   After promoting, invalidate the signal in extensions (step 8) and reload L3: the **custom widget tile** should show the same **ineligible** warning as the draft preview (no scalar). Restore eligibility → tile shows value or **“No live value available yet.”** again. Standard SWDEC / forecast cards unchanged.

16. **Phase L — Lifecycle (rename / enable / remove)**  
   With at least one custom widget and **`rides.update`**: toggle **Enabled** off — tile should show the disabled hint and **`GET .../custom-widgets`** should show **`enabled: false`** with no live preview fields. Toggle on again. Use **Rename** → change title → **Save title**; title updates in the tile and in **`GET`**. **Remove** → confirm — widget disappears (**`DELETE`** → **204**). Wrong **`widgetId`** → **`PATCH`/`DELETE`** **404** `CUSTOM_WIDGET_NOT_FOUND`. **`PATCH`** with `{}` or invalid **`enabled`** type → **400** `INVALID_CUSTOM_WIDGET_PATCH`.

17. **Phase M — Health summary and badges**  
   With custom widgets loaded, **`GET .../custom-widgets`** must include **`health`** on each row. The **summary** line counts total, OK, invalid (invalid_source + entity_mismatch), disabled, and no live value. Each tile shows a **badge** matching **`health`**. Disable a widget → badge **Off** and summary **disabled** increments. Restore a valid signal with no UNS row → **No live** / **`no_live_value`**. Invalidate extensions → **Invalid** / **`invalid_source`**.

18. **Phase N — Read-only vs editor (rides.update)**  
   Sign in as a user with **`rides.read`** only (no **`rides.update`**). With the flag **on**, open L3: you should see the picker, draft preview (when present), and **signal tiles** including health summary/badges. You must **not** see **Save as widget source**, **Promote to board widget**, or per-tile **rename / enabled / remove** controls. Sign in as an editor with **`rides.update`** and confirm those controls return.

## Optional Playwright

See **`admin-dashboard/e2e/addon-board-signal-picker.spec.ts`**.

- **Skipped** unless **`E2E_ADDON_BOARD_PARK_ID`** and **`E2E_ADDON_BOARD_RIDE_ID`** (platform asset id) are set.
- The dev server must be built/run with **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER=true`** (rollback switch **on** for the test). If Playwright starts Vite for you, set **`PLAYWRIGHT_ADDON_BOARD_PICKER=1`** so `playwright.config.ts` injects that env into the web server command.

Example:

```bash
cd admin-dashboard
set E2E_ADDON_BOARD_PARK_ID=<uuid>
set E2E_ADDON_BOARD_RIDE_ID=<asset-uuid>
set PLAYWRIGHT_START_WEB_SERVER=1
set PLAYWRIGHT_ADDON_BOARD_PICKER=1
npx playwright install
npx playwright test e2e/addon-board-signal-picker.spec.ts
```

If the picker is off or the asset has no board-eligible signals, the test **skips** after a short wait (no failure).
