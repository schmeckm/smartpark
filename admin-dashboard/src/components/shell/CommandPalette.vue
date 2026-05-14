<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { commandPaletteOpen, useCommandPalette } from '@/composables/useCommandPalette'

const inputRef = ref<HTMLInputElement | null>(null)

const {
  query,
  filteredPages,
  filteredRides,
  showNewIncident,
  navigateToRide,
  navigateToPage,
  navigateNewIncident,
  close,
  t,
} = useCommandPalette()

watch(commandPaletteOpen, async (open) => {
  if (open) {
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  }
})

function onBackdropPointerDown(ev: PointerEvent) {
  if (ev.target === ev.currentTarget) close()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="commandPaletteOpen"
      class="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/70 px-4 py-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      @pointerdown="onBackdropPointerDown"
    >
      <div
        class="w-full max-w-lg overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        @pointerdown.stop
      >
        <input
          ref="inputRef"
          v-model="query"
          type="search"
          autocomplete="off"
          class="w-full border-b border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          :placeholder="t('cmdK.placeholder')"
          @keydown.escape.prevent="close"
        />

        <div class="max-h-[min(60vh,420px)] overflow-y-auto py-2 text-sm">
          <section v-if="filteredRides.length">
            <p class="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {{ t('cmdK.groupRides') }}
            </p>
            <button
              v-for="r in filteredRides"
              :key="r.id"
              type="button"
              class="flex w-full px-4 py-2 text-left text-slate-200 hover:bg-slate-800"
              @click="navigateToRide(r.id)"
            >
              {{ r.name }}
            </button>
          </section>

          <section v-if="filteredPages.length">
            <p class="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {{ t('cmdK.groupPages') }}
            </p>
            <button
              v-for="p in filteredPages"
              :key="p.id"
              type="button"
              class="flex w-full px-4 py-2 text-left text-slate-200 hover:bg-slate-800"
              @click="navigateToPage(p)"
            >
              {{ t(p.titleKey) }}
            </button>
          </section>

          <section v-if="showNewIncident">
            <p class="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {{ t('cmdK.groupActions') }}
            </p>
            <button
              type="button"
              class="flex w-full px-4 py-2 text-left text-brand-300 hover:bg-slate-800"
              @click="navigateNewIncident()"
            >
              {{ t('cmdK.actionNewIncident') }}
            </button>
          </section>

          <p v-if="!filteredRides.length && !filteredPages.length && !showNewIncident" class="px-4 py-6 text-center text-slate-500">
            {{ t('cmdK.empty') }}
          </p>
        </div>

        <div class="border-t border-slate-800 px-4 py-2 text-[10px] text-slate-500">
          {{ t('cmdK.hint') }} · Esc {{ t('cmdK.close') }}
        </div>
      </div>
    </div>
  </Teleport>
</template>
