import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getPlatformParks } from '@/api/client'
import type { PlatformPark } from '@/types/api'
import { setApiParkContextId } from '@/utils/apiParkContext'

const STORAGE_KEY = 'sp_active_park_id'

function readStoredParkId(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v && v.trim() !== '' ? v.trim() : null
  } catch {
    return null
  }
}

export const useParkContextStore = defineStore('parkContext', () => {
  const parks = ref<PlatformPark[]>([])
  const activeParkId = ref<string | null>(readStoredParkId())
  const loaded = ref(false)
  const loadError = ref<string | null>(null)

  const activePark = computed(() => parks.value.find((p) => p.id === activeParkId.value) ?? null)

  function persistAndSyncHeader(id: string | null) {
    activeParkId.value = id
    setApiParkContextId(id)
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }

  /** Call when user is authenticated and may list parks (`rides.read`). */
  async function hydrate() {
    loadError.value = null
    try {
      parks.value = await getPlatformParks()
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Failed to load parks'
      parks.value = []
      persistAndSyncHeader(null)
      loaded.value = true
      return
    }

    const stored = readStoredParkId()
    const validStored = stored && parks.value.some((p) => p.id === stored)
    if (validStored) {
      persistAndSyncHeader(stored)
    } else if (parks.value.length === 1) {
      persistAndSyncHeader(parks.value[0].id)
    } else if (parks.value.length > 0) {
      persistAndSyncHeader(parks.value[0].id)
    } else {
      persistAndSyncHeader(null)
    }
    loaded.value = true
  }

  function setActivePark(id: string) {
    if (!parks.value.some((p) => p.id === id)) return
    persistAndSyncHeader(id)
  }

  function clearOnLogout() {
    parks.value = []
    loaded.value = false
    persistAndSyncHeader(null)
  }

  return {
    parks,
    activeParkId,
    activePark,
    loaded,
    loadError,
    hydrate,
    setActivePark,
    clearOnLogout,
  }
})
