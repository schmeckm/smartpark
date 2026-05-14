# Smart Park OS — Frontend Information Architecture Audit (F0)

**Scope:** Documentation-only snapshot for the **F0** track (no code or route
removals). The follow-on tracks (`F1` consolidation, `F2` IA refactor,
`F3` i18n hygiene) will reference these findings as acceptance criteria.

**Date:** 2026-05-08
**Stack:** Vue 3 + TypeScript + Vite, Pinia, vue-router, vue-i18n (en/de/fr/es),
Tailwind, Socket.IO, RBAC mirrored from `shared/rbac.json`.

**Inputs:**
- `admin-dashboard/src/router/index.ts` (single router file, ~80 route records)
- `admin-dashboard/shared/rbac.json` (`navigationGroups`)
- `admin-dashboard/src/layouts/MainLayout.vue` (sidebar render)
- `admin-dashboard/src/i18n/{en,de,fr,es}.json`
- All `admin-dashboard/src/views/**/*.vue` (~75 view files)

---

## 1. Executive summary

The frontend has grown a **broad, well-permissioned set of pages** but a
**narrow, hub-driven sidebar** that hides roughly half of the routed surfaces
behind a single hub click. The result is a navigation that **scales by adding
hubs and redirects** rather than by surfacing structure — and a small but
real layer of legacy / orphan views (`/mdm/*`, `PlatformAssetExplorerView`,
`AdapterPackagesView`) that compete with the canonical paths.

Three structural patterns drive most of the friction:

1. **Hub-only sub-trees.** `/iot-ot`, `/uns`, `/platform`, `/ai-insights`,
   and `/admin/master-data` each gate ~5–10 sub-pages, but the sidebar shows
   only the hub root (or 1–2 of its children). Discoverability is
   hub-card-driven, not nav-driven, and **breadcrumbs/sub-nav are not
   consistent across hubs**.
2. **Route ↔ menu drift.** Redirect routes are linked from the sidebar
   (e.g. `/platform/assets` → `/admin/master-data/rides`), so the active
   highlight ends up on a sibling item, not on the clicked one.
3. **Mixed naming.** The same concept ("asset data" / "ride MDM" /
   "master data" / "platform MDM") is labeled four different ways across
   menu, route titles, hub headings, and German hardcoded copy.

There are no broken routes today and RBAC is consistently enforced both in
the route guard and the nav filter, but the IA is **near the inflection
point** where adding one more hub will degrade the operator's mental model.

**Recommendation in one line:** consolidate the sidebar around **6 stable
top-level destinations**, replace redirect-based menu items with explicit
target paths, and require every hub to render a **breadcrumb + sibling tabs**
before adding new sub-pages.

---

## 2. IA snapshot — sidebar (today)

`navigationGroups` from `admin-dashboard/shared/rbac.json` rendered by
`MainLayout.vue`. Items are filtered per-user by `permission` /
`permissionsAny` / `requiredRoles`.

| # | Group (`titleKey`) | Items | Notes |
|---|---|---|---|
| 1 | `nav.section.controlTower` | 1 | Live Ops only |
| 2 | `nav.section.park` | 8 | "Asset data", "Asset list", explorer, map, visitor-flow, templates (legacy/debug), import, data-quality |
| 3 | `nav.section.operations` | 9 | Incidents, two Agent items, staff, live-queue, hotel guests, add-on, OEE, shift handover |
| 4 | `nav.section.predictiveMaintenance` | 1 | Single item |
| 5 | `nav.section.visualManagement` | 2 | SQDCP classic + hierarchical |
| 6 | `nav.section.analyticsReporting` | 2 | AI Insights + AI Studio |
| 7 | `nav.section.itOt` | 1 | Links to whole `/iot-ot` + `/uns` + `/live` + `/simulator` + `/settings/devices-services` + `/settings/adapter-pipeline-log` + `/integrations` sub-tree via `altActivePrefixes` |
| 8 | `nav.section.governance` | 2 | Audit log + Platform settings (SYSTEM_ADMIN) |
| + | `nav.section.personal` (injected in `MainLayout.vue`, not in manifest) | 2 | Help + Settings |

**Visible items (max, full-permissions user):** ~28
**Routed authenticated views:** ~56 (excluding redirects + detail routes)
→ **~50% of routed surfaces are reachable only via a hub card or direct URL.**

---

## 3. Route inventory and nav coverage

### 3.1 Reachable from sidebar (canonical paths)

| Section | URL | Route name | Component | Permission |
|---|---|---|---|---|
| Control Tower | `/` | `operations` | `OperationsDashboard.vue` | `dashboard.read` |
| Park & assets | `/admin/master-data/parks` | `master-data` | `MasterDataEntityView.vue` | `rides.read` |
| Park & assets | `/platform/assets` *(redirect → `/admin/master-data/rides`)* | `platform-assets` | — | `rides.read` |
| Park & assets | `/platform/parks` | `platform-parks` | `PlatformParkExplorerView.vue` | `rides.read` |
| Park & assets | `/platform/map` | `platform-map` | `PlatformAssetMapView.vue` | `rides.read` |
| Park & assets | `/platform/visitor-flow` | `platform-visitor-flow` | `PlatformVisitorFlowView.vue` | `rides.read` |
| Park & assets | `/platform/templates` | `platform-templates` | `PlatformTemplateManagementView.vue` | `rides.read` |
| Park & assets | `/import` | `import` | `ImportView.vue` | `import.create` |
| Park & assets | `/data-quality` | `data-quality` | `DataQualityView.vue` | `dataquality.read` |
| Operations | `/incidents` | `incidents` | `incidents/IncidentsListView.vue` | `incidents.read` |
| Operations | `/agent/inbox` | `agent-inbox` | `agent/AgentInboxView.vue` | `agent.review`/`approve` |
| Operations | `/agent/runs` | `agent-runs` | `agent/AgentRunsView.vue` | `agent.read` |
| Operations | `/staff-allocation` | `staff-allocation` | `StaffAllocationView.vue` | `staff.read` |
| Operations | `/platform/live-queue` | `platform-live-queue` | `PlatformLiveQueueView.vue` | `rides.read` |
| Operations | `/planning/hotel-guests` | `hotel-guest-planning` | `HotelGuestPlanningView.vue` | `rides.read` |
| Operations | `/operations/addon-board` | `addon-board` | `operations/AddonBoardView.vue` | `rides.read` |
| Operations | `/platform/oee` | `platform-oee` | `platform/PlatformOeeView.vue` | `rides.read` |
| Operations | `/platform/shift-handover` | `platform-shift-handover` | `PlatformShiftHandoverView.vue` | `rides.read` |
| Pred. maintenance | `/operations/predictive-maintenance` | `predictive-maintenance` | `operations/PredictiveMaintenanceView.vue` | `rides.read` |
| Visual mgmt | `/analytics/sqdc` | `sqdc-board` | `analytics/SqdcBoardView.vue` | `rides.read` |
| Visual mgmt | `/sqdc` | `sqdc-redirect` | `sqdc/SqdcParkRedirect.vue` | `rides.read` |
| Analytics | `/ai-insights` | `ai-insights` | `AiInsightsView.vue` | `ai.read` |
| Analytics | `/ai-insights/studio` | `ai-studio` | `AiStudioView.vue` | `ai.read` |
| IT-OT | `/iot-ot` | `iot-ot-hub` | `iot-ot/ItOtSettingsHubView.vue` | `iotOt.settings.read` |
| Governance | `/audit` | `audit` | `AuditLogsView.vue` | `audit.read` |
| Governance | `/admin/platform-settings` | `platform-settings` | `admin/PlatformSettingsView.vue` | role `SYSTEM_ADMIN` |
| Personal | `/help` | `help` | `help/HelpHubView.vue` | (open) |
| Personal | `/settings` | `settings` | `SettingsView.vue` | (open) |

### 3.2 Routed but **not in sidebar** (hub-only or direct-URL only)

| URL | Reachable via | Component |
|---|---|---|
| `/incidents/new`, `/incidents/:id` | inside Incidents list | `incidents/Incident{New,Detail}View.vue` |
| `/agent/runs/:id` | inside Agent Runs | `agent/AgentRunDetailView.vue` |
| `/sqdc/parks/:parkId`, `/sqdc/parks/:parkId/assets/:assetId` | from `/sqdc` redirect | `sqdc/{Park,Asset}SqdcBoard.vue` |
| `/ai-insights/accuracy` | AI Insights tiles | `AiForecastAccuracyView.vue` |
| `/ai-insights/timeseries` | AI Insights tiles | `AiRideTimeseriesView.vue` |
| `/ai-insights/ride-waits` | AI Insights tiles | `AiRideWaitGridView.vue` |
| `/ai-insights/ml-global-factors` | AI Insights tiles | `AiMlGlobalFactorsView.vue` |
| `/ai-insights/ml-park-factors` | AI Insights tiles | `AiMlParkFactorsView.vue` |
| `/ai-insights/ml-profiles` | AI Insights tiles | `AiMlProfilesView.vue` |
| `/ai-insights/feature-store-monitor` | AI Insights tiles | `AiFeatureStoreMonitorView.vue` |
| `/ai-insights/data-quality` | AI Insights tiles | `AiFeatureDataQualityView.vue` |
| `/iot-ot/sparkplug-edges` | IT-OT hub card | `iot-ot/SparkplugEdgeNodesView.vue` |
| `/uns/governance` *(default)* | IT-OT hub → UNS hub | `uns/UnsGovernanceConsoleView.vue` |
| `/uns/signal-view` | UNS tabs | `uns/UnsSignalView.vue` |
| `/uns/spy-inbox` | UNS tabs | `UnsSpyInboxView.vue` |
| `/uns/tree` | UNS tabs (diagnostic) | `uns/UnsTreeBuilderView.vue` |
| `/uns/topics` | UNS tabs (diagnostic) | `uns/UnsTopicsView.vue` |
| `/uns/live` | UNS tabs (diagnostic) | `uns/UnsLiveStateView.vue` |
| `/uns/oee-cockpit` | UNS tabs (diagnostic) | `uns/OeeMqttCockpitView.vue` |
| `/uns/registry-mirror` | UNS tabs (diagnostic) | `UnsRegistryMirrorView.vue` |
| `/live` | IT-OT hub | `Wave2LiveView.vue` |
| `/simulator` | IT-OT hub | `SimulatorView.vue` |
| `/settings/devices-services` | IT-OT hub | `settings/DevicesServicesView.vue` |
| `/settings/devices-services/integrations/:id` | inside Devices & Services | `settings/IntegrationDetailView.vue` |
| `/settings/adapter-pipeline-log` | IT-OT hub | `settings/AdapterPipelineLogView.vue` |
| `/integrations` | IT-OT hub + Platform Hub | `IntegrationSettingsView.vue` |
| `/platform` | (none — hub itself is unreachable from sidebar) | `platform/PlatformHubView.vue` |
| `/platform/rides/:assetId` | from Master Data tabs | `platform/PlatformRideMasterEditorView.vue` |
| `/platform/shift-handover/logbook` | from Shift handover | `platform/PlatformShiftHandoverLogbookView.vue` |
| `/admin/master-data/:entityType` (other than `parks`) | Master Data tabs | `master-data/MasterDataEntityView.vue` |
| `/mdm/rides`, `/mdm/rides/new`, `/mdm/rides/:id`, `/mdm/templates`, `/mdm/zones` | direct URL only — **not linked anywhere in nav** | `mdm/Mdm*.vue` |

### 3.3 Redirects (legacy aliases)

| From | To | Note |
|---|---|---|
| `/integrations/adapters` | `/settings/devices-services` | naming drift "adapters" → "devices & services" |
| `/park-entities` | `/integrations` | legacy URL |
| `/admin/master-data` | `/admin/master-data/parks` | default tab |
| `/admin/master-data/attractions` | `/admin/master-data/rides` | naming drift "attractions" → "rides" |
| `/admin/uns-registry/mirror` | `/uns/registry-mirror` | UNS reorg |
| `/admin/uns-spy/inbox` | `/uns/spy-inbox` | UNS reorg |
| `/admin/uns-governance` | `/uns/governance` | UNS reorg |
| `/platform/assets` | `/admin/master-data/rides` | **linked from sidebar** — see F0-2 |
| `/:pathMatch(.*)*` | `/` | catch-all |

### 3.4 Orphan views (in `src/views/` but **never routed**)

| File | Suspected status |
|---|---|
| `views/adapters/AdapterPackagesView.vue` | dead (superseded by `DevicesServicesView`) |
| `views/platform/PlatformAssetExplorerView.vue` | dead (superseded by `MasterDataEntityView` on `/admin/master-data/:entityType`) |
| `views/master-data/MasterDataWizard.vue` | imported from another view (component, not a route) — verify before delete |
| `views/master-data/RideSignalCapabilitiesPanel.vue` | imported as panel — keep, but rename out of `views/` |
| `views/settings/ProviderSelectDialog.vue` | dialog component — keep, but rename out of `views/` |

---

## 4. Findings

Each finding is tagged with severity (S = Structural / U = UX / H = Hygiene)
and an owner suggestion.

### F0-1 (S) Half the routed surface is hub-only with no consistent sub-nav

`/iot-ot`, `/uns`, `/platform`, `/ai-insights`, `/admin/master-data`,
`/incidents`, `/agent/*` are all hub-style trees, but only `/uns` renders a
**tab strip via a parent route + `<RouterView />`**
(`uns/UnsHubView.vue`). The other hubs are **plain landing pages** with
card grids; clicking a card replaces the entire route with no
breadcrumb back to the hub.

**Effect:** Operators who land on `/iot-ot/sparkplug-edges` from a deep
link have **no UI hint** that they are inside an IT-OT subsystem; the
sidebar still highlights "IT-OT Settings" via `altActivePrefixes`, but
there is no "← back to IT-OT" or sibling tab strip.

### F0-2 (S) Sidebar links a redirect; active state lands on a sibling

`shared/rbac.json` line 268 routes the "Asset list" sidebar item to
`/platform/assets`, which `router/index.ts` line 401–405 redirects to
`/admin/master-data/rides`. After the redirect, the URL prefix is
`/admin/master-data` — which is the `activePathPrefix` of the
**previous** sidebar item ("Asset data" / `/admin/master-data/parks`,
line 264). So clicking "Asset list" highlights "Asset data".

`router/index.ts` line 404 even sets `meta.titleKey: 'menu.masterData'` on
the redirect record, but redirect records do not render — the meta is
dead.

### F0-3 (S) Two parallel "ride MDM" stacks

| Stack | Entry | Views |
|---|---|---|
| **New (canonical)** | `/admin/master-data/:entityType` + `/platform/rides/:assetId` | `MasterDataEntityView`, `PlatformRideMasterEditorView` |
| **Legacy** | `/mdm/rides`, `/mdm/rides/new`, `/mdm/rides/:id`, `/mdm/templates`, `/mdm/zones` | `MdmRidesListView`, `MdmRideWizardView`, `MdmRideDetailView`, `MdmTemplatesView`, `MdmZoneAssignmentView` |

The legacy `/mdm/*` is fully routed (5 views) but **never linked from
the sidebar or any hub**. `PlatformHubView.vue` line 113 explicitly
warns:

> Der Menüpunkt „Ride MDM" unter `/mdm` ist das **ältere** MDM-Modell
> und nicht dieselbe Datenbank wie die Platform-Assets.

This is a clear deprecation candidate. Until removed, the routes are a
liability: a stale bookmark still works and writes to a parallel table.

### F0-4 (H) Naming drift across menu, page title, hub heading

| Concept | `menu.*` (en) | `meta.title`/`titleKey` | Hub heading | German label |
|---|---|---|---|---|
| Master data of assets | `Asset data` | `menu.masterData` | "Platform MDM" / "Ride MDM (older)" | `Asset-Daten` |
| Platform hub | (no menu entry) | `Platform MDM` | `Platform MDM` (hardcoded H1) | hardcoded |
| OEE board | `OEE` | `menu.oeeDowntime` | "OEE — Verfügbarkeit & Stillstände" | `OEE` |
| Shift handover | `Shift handover` | `Schichtübergabe` (DE hardcoded) | hardcoded DE | `Schichtübergabe` |
| Adapter logs | `Adapter operations center` | `Adapter operations center` | hub card | mixed |
| Integrations / providers | `Integrations` | `Integrations` | "Integrationen" (DE) | `Integrationen` |

The user-visible noun for the same row will change from `Asset data`
(menu) to `Platform MDM` (page H1) to `Ride MDM` (warning) within a
single click.

### F0-5 (H) i18n: hardcoded German copy inside hubs and detail pages

Several views render German strings directly in `<template>` instead of
through `t(...)`:

- `views/iot-ot/ItOtSettingsHubView.vue` lines 17–70 — every hub-card
  `title`/`description`/`whatToDo` is hardcoded German.
- `views/platform/PlatformHubView.vue` lines 11–14, 19, 27–34, 49–113 —
  H1, body, card headers and footnote are hardcoded German.
- `router/index.ts` line 416 (`Schichtübergabe`), 422 (`Schicht-Logbuch`)
  — German `meta.title` strings.

Result: switching the locale to `en/fr/es` does **not** translate these
pages, only the chrome (sidebar, header).

### F0-6 (H) `meta.title` vs `meta.titleKey` strategy is mixed

`router/afterEach` (line 568–574) prefers `titleKey` and falls back to
`title`. About **23 routes use `title` (English-only)** and **30 use
`titleKey`**. The split is not by feature area — it accumulated as
features landed.

Document title in non-English locales is therefore **only correctly
localized for the routes that happened to use `titleKey`**.

### F0-7 (S) RBAC: `rides.read` overloaded as the "operations user" gate

The following sidebar items all gate on `rides.read`:

`menu.masterData`, `menu.assetList`, `menu.parkExplorer`, `menu.assetMap`,
`menu.visitorFlow`, `menu.templatesLegacyDebug`, `menu.liveQueue`,
`menu.hotelGuestPlanning`, `menu.addonBoard`, `menu.oeeDowntime`,
`menu.shiftHandover`, `menu.predictiveMaintenance`, `menu.sqdcBoard`,
`menu.sqdcHierarchical`.

Several of these are **not semantically about rides** (hotel guests,
shift handover, SQDCP P-pillar, visitor flow). The effect is benign
today (the role grid is coarse) but it blocks any future
finer-grained gate (e.g. "let HR see hotel guests but not OEE")
without re-shimming every route.

`HR_MANAGER` does not have `rides.read`, so they cannot see hotel
guest planning even though "guest visits" is arguably HR-adjacent.

### F0-8 (U) Section over-segmentation

Two top-level sections in the sidebar contain a **single item**:

- `nav.section.predictiveMaintenance` → 1 entry.
- `nav.section.controlTower` → 1 entry (Live Ops).

And one section contains exactly two:

- `nav.section.analyticsReporting` → AI Insights + AI Studio.
- `nav.section.visualManagement` → SQDCP classic + hierarchical.

Combined with **9 top-level sections** (incl. injected `personal`),
this dilutes the visual rhythm of the sidebar. The 9-item split also
forces some real outliers into nominal homes (e.g. `staff-allocation`
sits in **Operations** even though most operations items are
ride/asset-centric, not workforce-centric).

### F0-9 (S) Two orphan view files

`views/adapters/AdapterPackagesView.vue` and
`views/platform/PlatformAssetExplorerView.vue` are imported from
nowhere and never routed. They appear to be predecessors of
`DevicesServicesView` and `MasterDataEntityView` respectively. Tree-
shaking removes them from the bundle, but they are reviewed every
PR and they confuse code search.

### F0-10 (U) Path hierarchy ↔ menu hierarchy mismatch (AI sub-tree)

`/ai-insights/studio` is a URL **child** of `/ai-insights`, but the
sidebar shows them as **siblings** in `analyticsReporting`. The
manifest mitigates this with
`activeExcludePrefixes: ["/ai-insights/studio"]` on the parent —
that works but is a workaround for an IA decision the URL already
made.

The same situation exists for the 8 other `/ai-insights/*` sub-pages
(`accuracy`, `timeseries`, `ride-waits`, `ml-global-factors`,
`ml-park-factors`, `ml-profiles`, `feature-store-monitor`,
`data-quality`) which **are not in the sidebar at all** — they live
only as cards inside `AiInsightsView.vue`. Operators have to discover
them by clicking through the hub.

### F0-11 (U) UNS hub mixes its own children with a cross-link

`uns/UnsHubView.vue` lines 8–18 list 9 tabs, including
`{ to: '/data-quality', labelKey: 'menu.dataQuality' }`. `/data-quality`
is **not a child of `/uns`** — it is a top-level page also in the
sidebar. While it's there to be useful, it produces:

- A double-listing in the running app (sidebar **and** UNS tabs).
- An ambiguous active state when the user is on `/data-quality`: which
  surface owns it?

### F0-12 (H) Confusing redirect names

Five redirects exist for legacy URLs (`/integrations/adapters`,
`/park-entities`, `/admin/uns-*`, `/admin/master-data*`,
`/platform/assets`). They are mostly fine, but two stand out:

- `/integrations/adapters` → `/settings/devices-services`: the URL
  promises "adapter management"; the destination is named
  "devices & services". Either rename the destination or rename the
  legacy URL.
- `/platform/assets` → `/admin/master-data/rides`: see F0-2 above.
  This is the **only redirect actively linked from the sidebar**.

### F0-13 (U) No global search, no breadcrumbs, no back-affordance

There is no `/search` route, no command palette, and no breadcrumb
component. With ~75 view files, the only orientation aids are:

- The sidebar (covers ~28 destinations).
- Page H1 (sometimes hardcoded, sometimes localized).
- The header line `route.meta.titleKey || meta.title` shown small
  above the page in `MainLayout.vue` line 318.

Given that ~50% of routes are not in the sidebar, this is the single
biggest discoverability gap.

### F0-14 (H) Two `titleKey` collisions

| `titleKey` | Routes |
|---|---|
| `sqdc.hierarchicalParkTitle` | `/sqdc` (redirect view) and `/sqdc/parks/:parkId` |
| `menu.masterData` | `/admin/master-data/:entityType` and `/platform/assets` (redirect) |

Both are intentional today, but they make the document title and the
sidebar active-state ambiguous when both pages can render at once
(e.g. via stale tabs).

### F0-15 (U) Personal section is injected client-side, not in the manifest

`MainLayout.vue` lines 156–164 push a 4th "personal" group with `Help`
and `Settings` directly into the rendered `navSections`, instead of
having `shared/rbac.json` declare it. RBAC sync (`verify:rbac`) does
not see it, and any platform that consumes the manifest
(`shared/rbac.json`) for nav rendering will miss those two items.

---

## 5. Quantitative summary

| Metric | Count |
|---|---|
| Total route records | ~80 |
| of which redirects | 9 |
| of which detail (`:id`) | 7 |
| Authenticated, non-redirect, non-detail routes | ~56 |
| Sidebar-visible items (max) | 28 |
| **Hub-only / direct-URL only routes** | **~28 (≈50%)** |
| Top-level sidebar sections | 8 (+1 injected) |
| Sections with ≤ 2 items | 5 |
| Orphan views in `src/views/` | 2 confirmed dead, 3 mis-located components |
| Routes using `meta.title` only (not `titleKey`) | ~23 |
| Hardcoded German strings in templates | 3 large views (`PlatformHubView`, `ItOtSettingsHubView`, `PlatformShiftHandoverView` titles) + 2 `meta.title` |
| Legacy ride MDM routes still live | 5 |

---

## 6. Recommendations (prioritized for F1+)

### 6.1 Must-do before adding any new top-level page

1. **Decide the side-nav contract.** Either: (a) every routed page that an
   operator should reach without a hub click is in the sidebar, or (b)
   the sidebar shows only "destinations" and every hub has a guaranteed
   tab strip + breadcrumb. Today the codebase mixes both. Pick one.
2. **Fix `/platform/assets` (F0-2).** Change the sidebar entry to point
   directly at `/admin/master-data/rides`, or restructure
   `/platform/assets` into a real list view. Do not link a redirect from
   the sidebar.
3. **Promote `personal` to the manifest (F0-15).** Move Help + Settings
   into `shared/rbac.json` and out of `MainLayout.vue` so the manifest
   is the single source of truth for nav.

### 6.2 Should-do (F2 IA refactor — single PR)

4. **Collapse to 6 top-level sections.** Suggested:

   | Section | Owns |
   |---|---|
   | Control Tower | Live Ops, Incidents, Agent Inbox |
   | Park & Assets | Master data tabs, Asset map, Visitor flow, Park explorer, Import, Data quality |
   | Operations | Staff allocation, Live queue, Add-on board, OEE, Shift handover, Hotel guests, Predictive maintenance, SQDCP (both) |
   | Insights | AI Insights (with sub-tabs), AI Studio, Audit log |
   | IT-OT | IT-OT hub, UNS, Live, Simulator, Devices & Services, Adapter ops, Integrations |
   | Admin | Platform settings, Help, Settings |

   This drops 2-of-9 single-item sections, gives Predictive Maintenance
   and SQDCP a real home in Operations, and gives Audit a home in
   Insights (where its readers actually look for it).

5. **Mandatory hub UX.** Every hub route (`/iot-ot`, `/platform`,
   `/ai-insights`, `/admin/master-data`, `/agent`, `/incidents`) must
   render:
   - a localized H1 (no hardcoded German),
   - a sibling-tab strip OR a back-link to the parent,
   - a breadcrumb (3-level max).
   Use the `uns/UnsHubView.vue` parent-route + `<RouterView />` pattern
   as the reference; extend `usePageSurfaces`/`MainLayout` to pass an
   optional breadcrumb.

6. **Sidebar-link the AI sub-pages that operators actually hit daily.**
   At minimum: AI Insights (overview), AI Studio, AI Forecast Accuracy.
   Move the rest under a sub-tab strip on `AiInsightsView.vue`.

### 6.3 Hygiene (F3 cleanup pass)

7. **Convert all `meta.title` to `meta.titleKey`** (F0-6) — make
   `meta.title` fail the lint rule. Add the missing keys in `i18n/*`.
8. **Translate `PlatformHubView.vue`, `ItOtSettingsHubView.vue` and
   the `Schichtübergabe` titles** (F0-5).
9. **Delete the 2 orphan views** (F0-9): `AdapterPackagesView.vue`,
   `PlatformAssetExplorerView.vue`. Move `MasterDataWizard.vue`,
   `RideSignalCapabilitiesPanel.vue`, `ProviderSelectDialog.vue`
   out of `views/` into `components/`.
10. **Decide the fate of `/mdm/*`** (F0-3). Two options:
    - **Hide** with a `feature.legacyMdm` flag and add a deprecation
      banner pointing to the new path. Remove in a follow-up.
    - **Delete now** if nothing in the docs / external bookmarks
      depends on it (verify by searching server logs for `/mdm/`).
11. **Resolve the `/platform/assets`, `/integrations/adapters` and
    other naming drifts** (F0-2, F0-12, F0-4) — pick one noun per
    concept and apply it consistently in: route name, URL segment,
    `menu.*` key, hub card, page H1, German label.
12. **Add `rides.read` aliases or split it** (F0-7). Concretely:
    - Introduce `assets.read` and `operations.read` as semantic
      synonyms in `shared/rbac.json` so HR / Workforce tooling can
      gate without `rides.read`.
    - Or document explicitly that `rides.read` = "operator can see
      operations content" and rename the permission accordingly.

### 6.4 Nice-to-have (F4)

13. **Global search / command palette.** A single `⌘K` palette over the
    nav manifest (label + URL + permission filter) gives operators a
    direct route to any of the ~28 hub-buried pages without
    restructuring the sidebar. Cheapest discoverability win.
14. **Breadcrumb component**, fed from `route.matched` + `meta.titleKey`.

---

## 7. Acceptance criteria for follow-on phases

| Track | Done when |
|---|---|
| **F1 — quick wins** | F0-2, F0-9, F0-15 closed. No sidebar entries point to redirect-only routes. No orphan views in `src/views/`. RBAC manifest owns the personal section. |
| **F2 — IA refactor** | Sidebar has ≤ 6 top-level sections. Every hub renders breadcrumb + sibling tabs. Path hierarchy matches menu hierarchy for `/ai-insights/*` and `/admin/master-data/*`. |
| **F3 — hygiene** | 100% of `meta.title` converted to `meta.titleKey`. No hardcoded German strings flagged by `npm run i18n:lint` (new check). Legacy `/mdm/*` either flagged or removed. |
| **F4 — discoverability** | Global search / command palette ships. Breadcrumb component used in all hubs and detail pages. |

---

## 8. References

- Backend audit (sibling): [`docs/architecture/backend-audit.md`](backend-audit.md)
- Source-of-truth matrix: [`docs/architecture/source-of-truth.md`](source-of-truth.md)
- RBAC manifest (single source of truth, frontend mirror):
  `shared/rbac.json` ↔ `admin-dashboard/shared/rbac.json` (kept in sync by
  `npm run verify:rbac`)
- Router: `admin-dashboard/src/router/index.ts`
- Layout / sidebar: `admin-dashboard/src/layouts/MainLayout.vue`
- Locale files: `admin-dashboard/src/i18n/{en,de,fr,es}.json`

---

*This document is the F0 deliverable for the Frontend IA track. It does not
modify any code; it gates the F1-F4 PRs against the findings above.*
