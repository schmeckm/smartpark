<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getMaintenanceTemplates, getRideTemplates, getStaffingTemplates } from '@/api/client'
import { useToast } from '@/composables/useToast'

const { push } = useToast()
const ride = ref<Array<Record<string, unknown>>>([])
const staff = ref<Array<Record<string, unknown>>>([])
const maint = ref<Array<Record<string, unknown>>>([])

onMounted(async () => {
  try {
    const [r, s, m] = await Promise.all([getRideTemplates(), getStaffingTemplates(), getMaintenanceTemplates()])
    ride.value = r
    staff.value = s
    maint.value = m
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
    <h1 class="font-display text-xl font-semibold text-white">Template management</h1>
    <div class="grid gap-4 lg:grid-cols-3">
      <section class="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <h2 class="text-sm font-medium text-white">Ride templates</h2>
        <pre class="mt-2 max-h-96 overflow-auto font-mono text-[10px] text-slate-400">{{ JSON.stringify(ride, null, 2) }}</pre>
      </section>
      <section class="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <h2 class="text-sm font-medium text-white">Staffing templates</h2>
        <pre class="mt-2 max-h-96 overflow-auto font-mono text-[10px] text-slate-400">{{ JSON.stringify(staff, null, 2) }}</pre>
      </section>
      <section class="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <h2 class="text-sm font-medium text-white">Maintenance templates</h2>
        <pre class="mt-2 max-h-96 overflow-auto font-mono text-[10px] text-slate-400">{{ JSON.stringify(maint, null, 2) }}</pre>
      </section>
    </div>
  </div>
</template>
