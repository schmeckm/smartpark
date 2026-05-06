<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'

const fileStaff = ref<File | null>(null)
const fileRides = ref<File | null>(null)
const fileZones = ref<File | null>(null)
const result = ref<unknown>(null)
const busy = ref(false)
const { push } = useToast()
const auth = useAuthStore()

const origin = import.meta.env.VITE_API_URL || ''

async function post(path: string, f: File | null) {
  if (!f) {
    push('Select a file first', 'error')
    return
  }
  busy.value = true
  result.value = null
  const fd = new FormData()
  fd.append('file', f)
  try {
    const res = await fetch(`${origin}/api/v1/import/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.accessToken || ''}` },
      body: fd,
    })
    const j = await res.json()
    if (!res.ok) throw new Error(j.message || res.statusText)
    result.value = j.data
    push('Import completed', 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Import failed', 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
    <h1 class="font-display text-xl font-semibold text-white">CSV / Excel import</h1>
    <p class="text-sm text-slate-400">Upload .csv, .xlsx, or .xls. One bad row is reported; others still import.</p>
    <div class="space-y-4">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label class="text-xs text-slate-500">Staff</label>
          <input type="file" class="block text-sm" @change="(e) => (fileStaff = (e.target as HTMLInputElement).files?.[0] || null)" />
        </div>
        <button
          class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          :disabled="busy"
          @click="post('staff', fileStaff)"
        >
          Import staff
        </button>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label class="text-xs text-slate-500">Rides</label>
          <input type="file" class="block text-sm" @change="(e) => (fileRides = (e.target as HTMLInputElement).files?.[0] || null)" />
        </div>
        <button
          class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          :disabled="busy"
          @click="post('rides', fileRides)"
        >
          Import rides
        </button>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label class="text-xs text-slate-500">Zones</label>
          <input type="file" class="block text-sm" @change="(e) => (fileZones = (e.target as HTMLInputElement).files?.[0] || null)" />
        </div>
        <button
          class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          :disabled="busy"
          @click="post('zones', fileZones)"
        >
          Import zones
        </button>
      </div>
    </div>
    <pre v-if="result" class="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">{{ result }}</pre>
  </div>
</template>
