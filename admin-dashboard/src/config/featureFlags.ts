/**
 * Build-time flags (Vite). Defaults keep legacy behaviour unless explicitly enabled.
 *
 * @see admin-dashboard/.env.example — `VITE_USE_OPERATIONS_FACTS_FOR_RIDE_DASHBOARD`
 */
export const operationsFactsRideDashboardPilotEnabled =
  import.meta.env.VITE_USE_OPERATIONS_FACTS_FOR_RIDE_DASHBOARD === 'true'

/**
 * Add-on Board L3 — custom signal widgets (picker, draft, tiles). Build-time **rollback switch**:
 * set `VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER=false` or omit to hide the UI; no separate experiment flag.
 */
export const addonBoardSignalSourcePickerEnabled =
  import.meta.env.VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER === 'true'
