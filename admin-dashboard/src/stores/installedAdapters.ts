import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { getInstalledAdapters } from '@/api/client'

/** Must match `src/integrations/adapter-packages/traffic_corridors/manifest.json` adapterKey. */
export const TRAFFIC_CORRIDORS_ADAPTER_KEY = 'traffic_corridors'

/** Must match `src/integrations/adapter-packages/traffic_tomtom/manifest.json` adapterKey. */
export const TRAFFIC_TOMTOM_ADAPTER_KEY = 'traffic_tomtom'

/**
 * Corridors UI + attendance-risk surfaces stay available when TomTom routing is installed,
 * even if the legacy `traffic_corridors` scheduler package row was removed.
 */
export const TRAFFIC_CORRIDORS_SURFACE_ADAPTER_KEYS = [
  TRAFFIC_CORRIDORS_ADAPTER_KEY,
  TRAFFIC_TOMTOM_ADAPTER_KEY,
] as const

/** Must match `src/integrations/adapter-packages/predictive_maintenance/manifest.json` adapterKey. */
export const PREDICTIVE_MAINTENANCE_ADAPTER_KEY = 'predictive_maintenance'

export const useInstalledAdaptersStore = defineStore('installedAdapters', () => {
  const keys = shallowRef<ReadonlySet<string>>(new Set())
  const loaded = ref(false)
  const loadError = ref<string | null>(null)

  function clearOnLogout() {
    keys.value = new Set()
    loaded.value = false
    loadError.value = null
  }

  function isInstalled(adapterKey: string) {
    return keys.value.has(adapterKey)
  }

  function isAnyInstalled(adapterKeys: readonly string[]) {
    return adapterKeys.some((k) => keys.value.has(String(k).trim()))
  }

  async function hydrate() {
    loadError.value = null
    try {
      const res = await getInstalledAdapters()
      const next = new Set<string>()
      for (const p of res.packages ?? []) {
        const k = String(p.adapterKey || '').trim()
        if (k) next.add(k)
      }
      keys.value = next
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Failed to load adapters'
      keys.value = new Set()
    } finally {
      loaded.value = true
    }
  }

  return { keys, loaded, loadError, hydrate, clearOnLogout, isInstalled, isAnyInstalled }
})
