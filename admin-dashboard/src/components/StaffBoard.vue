<script setup lang="ts">
import { computed } from 'vue'
import type { Staff, StaffRole, Zone } from '../types/api'

const props = defineProps<{
  zones: Zone[]
  staff: Staff[]
}>()

const roleLabels: Record<StaffRole, string> = {
  FOOD_SERVICE: 'Food',
  RIDE_OPERATOR: 'Rides',
  CLEANING: 'Cleaning',
  SECURITY: 'Security',
  GUEST_SERVICE: 'Guest svc',
}

function roleClass(role: StaffRole) {
  const map: Record<StaffRole, string> = {
    FOOD_SERVICE: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    RIDE_OPERATOR: 'border-brand-500/30 bg-brand-500/10 text-brand-100',
    CLEANING: 'border-teal-500/30 bg-teal-500/10 text-teal-100',
    SECURITY: 'border-rose-500/30 bg-rose-500/10 text-rose-100',
    GUEST_SERVICE: 'border-violet-500/30 bg-violet-500/10 text-violet-100',
  }
  return map[role]
}

const columns = computed(() => {
  const zoneCols = [...props.zones].sort((a, b) => a.name.localeCompare(b.name))
  const byZone = new Map<string, Staff[]>()
  byZone.set('unassigned', [])
  for (const z of zoneCols) byZone.set(z.id, [])
  for (const s of props.staff) {
    if (s.currentZoneId && byZone.has(s.currentZoneId)) {
      byZone.get(s.currentZoneId)!.push(s)
    } else {
      byZone.get('unassigned')!.push(s)
    }
  }
  return { zoneCols, byZone }
})

function staffInZone(zoneId: string): Staff[] {
  return columns.value.byZone.get(zoneId) ?? []
}
</script>

<template>
  <section class="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-panel">
    <div class="mb-4">
      <h2 class="font-display text-lg font-semibold text-white">Staff allocation</h2>
      <p class="mt-1 text-sm text-slate-400">Live roster by zone · drag-free board for control room</p>
    </div>

    <div
      class="flex gap-4 overflow-x-auto pb-2"
      style="scrollbar-gutter: stable"
    >
      <div
        v-for="z in columns.zoneCols"
        :key="z.id"
        class="flex w-[220px] shrink-0 flex-col rounded-xl border border-slate-800 bg-slate-950/60"
      >
        <div class="border-b border-slate-800 px-3 py-2">
          <p class="font-display text-sm font-semibold text-white">{{ z.name }}</p>
          <p class="text-[10px] uppercase tracking-wide text-slate-500">{{ z.type }}</p>
        </div>
        <div class="flex flex-1 flex-col gap-2 p-2">
          <div
            v-if="!staffInZone(z.id).length"
            class="rounded-lg border border-dashed border-slate-700/80 py-6 text-center text-xs text-slate-500"
          >
            No assignments
          </div>
          <article
            v-for="s in staffInZone(z.id)"
            :key="s.id"
            class="rounded-lg border border-slate-700/80 bg-slate-900/80 p-2.5 shadow-sm"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="text-sm font-medium text-white">
                  {{ s.firstName }} {{ s.lastName }}
                </p>
                <p v-if="s.employeeNumber" class="mt-0.5 font-mono text-[10px] text-slate-500">
                  {{ s.employeeNumber }}
                </p>
                <p v-if="s.supervisor" class="mt-1 text-[10px] text-slate-500">
                  Sup.: {{ s.supervisor.firstName }} {{ s.supervisor.lastName }}
                </p>
              </div>
              <span
                v-if="!s.available"
                class="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-300"
              >
                Busy
              </span>
            </div>
            <p
              class="mt-1.5 inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :class="roleClass(s.role)"
            >
              {{ roleLabels[s.role] }}
            </p>
            <p class="mt-1 text-[10px] text-slate-500">Skill L{{ s.skillLevel }}</p>
          </article>
        </div>
      </div>

      <div
        v-if="columns.byZone.get('unassigned')?.length"
        class="flex w-[200px] shrink-0 flex-col rounded-xl border border-dashed border-slate-700 bg-slate-950/40"
      >
        <div class="border-b border-slate-800 px-3 py-2">
          <p class="text-sm font-semibold text-slate-300">Unassigned</p>
        </div>
        <div class="flex flex-col gap-2 p-2">
          <article
            v-for="s in columns.byZone.get('unassigned')"
            :key="s.id"
            class="rounded-lg border border-slate-700/60 bg-slate-900/60 p-2.5"
          >
            <div>
              <p class="text-sm font-medium text-slate-200">
                {{ s.firstName }} {{ s.lastName }}
              </p>
              <p v-if="s.employeeNumber" class="mt-0.5 font-mono text-[10px] text-slate-500">
                {{ s.employeeNumber }}
              </p>
              <p v-if="s.supervisor" class="mt-1 text-[10px] text-slate-500">
                Sup.: {{ s.supervisor.firstName }} {{ s.supervisor.lastName }}
              </p>
            </div>
            <p
              class="mt-1.5 inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase"
              :class="roleClass(s.role)"
            >
              {{ roleLabels[s.role] }}
            </p>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
