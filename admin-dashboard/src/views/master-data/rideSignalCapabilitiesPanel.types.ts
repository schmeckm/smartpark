/** Public instance API from `RideSignalCapabilitiesPanel` `defineExpose` — for parent refs (e.g. Master Data wizard save). */
export type RideSignalCapsPanelExpose = {
  flushSignalCapabilitiesIfDirty: () => Promise<boolean>
}
