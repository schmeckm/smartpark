import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { getRides } from '@/api/client'
import type { Ride } from '@/types/api'

/**
 * F2-MVP · Ride context.
 *
 * Single source of truth for the ride object used across the 7 ride-detail
 * tabs (Overview · Live · Queue · OEE · Maintenance · AI · Diagnostics).
 *
 * Why pull the ride list and pick by id rather than hit a per-id endpoint:
 *   - the existing `/api/v1/rides` already returns the slim `Ride` shape the
 *     ride header needs (name, zone, status, waitTime, capacityPerHour);
 *   - module-level cache means follow-up tab navigations are instant;
 *   - we deliberately do NOT use the heavier `/mdm/rides/:id` endpoint here
 *     — that's the master-data view, not the operational ride object.
 */
const cache = new Map<string, Ride>()
let inflightAll: Promise<Ride[]> | null = null

async function loadAllRidesOnce(): Promise<Ride[]> {
  if (!inflightAll) {
    inflightAll = getRides()
      .then((rides) => {
        for (const r of rides) cache.set(r.id, r)
        return rides
      })
      .catch((err) => {
        inflightAll = null
        throw err
      })
  }
  return inflightAll
}

export interface UseRideContext {
  ride: ComputedRef<Ride | null>
  loading: Ref<boolean>
  error: Ref<Error | null>
  refresh: () => Promise<void>
}

export function useRideContext(rideId: Ref<string> | ComputedRef<string>): UseRideContext {
  const rideRef = ref<Ride | null>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)

  async function resolve(id: string) {
    if (!id) {
      rideRef.value = null
      return
    }
    if (cache.has(id)) {
      rideRef.value = cache.get(id) ?? null
      return
    }
    loading.value = true
    error.value = null
    try {
      const all = await loadAllRidesOnce()
      const found = all.find((r) => r.id === id) ?? null
      rideRef.value = found
      if (!found) {
        error.value = new Error(`Ride not found: ${id}`)
      }
    } catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e))
    } finally {
      loading.value = false
    }
  }

  watch(
    () => rideId.value,
    (id) => {
      void resolve(id)
    },
    { immediate: true },
  )

  async function refresh() {
    inflightAll = null
    cache.clear()
    await resolve(rideId.value)
  }

  return {
    ride: computed(() => rideRef.value),
    loading,
    error,
    refresh,
  }
}
