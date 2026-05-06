/** Same key as Simulator MD ride checkboxes — drives OEE cockpit card list when set. */
export const OEE_MD_ASSET_SELECTION_KEY = 'sp_oee_md_asset_selection_v1'

const CHANGED = 'sp-oee-md-selection-changed'

export function loadPersistedMdAssetIds(parkId: string): string[] {
  try {
    const raw = localStorage.getItem(`${OEE_MD_ASSET_SELECTION_KEY}:${parkId}`)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  } catch {
    return []
  }
}

export function loadPersistedMdAssetIdMap(parkId: string): Record<string, boolean> {
  return Object.fromEntries(loadPersistedMdAssetIds(parkId).map((id) => [id, true as const]))
}

export function persistMdAssetSelection(parkId: string, selectedByAssetId: Record<string, boolean>) {
  const ids = Object.entries(selectedByAssetId)
    .filter(([, v]) => v)
    .map(([id]) => id)
  try {
    localStorage.setItem(`${OEE_MD_ASSET_SELECTION_KEY}:${parkId}`, JSON.stringify(ids))
  } catch {
    /* quota */
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: { parkId } }))
  } catch {
    /* no window */
  }
}

export function onMdAssetSelectionChanged(handler: (parkId: string) => void): () => void {
  const fn = (ev: Event) => {
    const pid = (ev as CustomEvent<{ parkId?: string }>).detail?.parkId
    if (typeof pid === 'string') handler(pid)
  }
  window.addEventListener(CHANGED, fn)
  return () => window.removeEventListener(CHANGED, fn)
}
