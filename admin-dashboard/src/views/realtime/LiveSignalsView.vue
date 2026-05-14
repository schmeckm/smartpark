<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import UnsLiveStateView from '@/views/uns/UnsLiveStateView.vue'
import OeeMqttCockpitView from '@/views/uns/OeeMqttCockpitView.vue'

const { t } = useI18n()
const route = useRoute()
const mode = ref<'signals' | 'oee'>(route.query.mode === 'oee' ? 'oee' : 'signals')
</script>

<template>
  <div class="min-h-full">
    <div class="border-b border-slate-800 bg-slate-900/40 px-4 sm:px-6">
      <div class="flex items-end justify-between gap-4 pb-3 pt-4">
        <div>
          <h1 class="font-display text-lg font-semibold text-white">{{ t('realtime.liveSignals.title') }}</h1>
          <p class="mt-0.5 text-xs text-slate-500">{{ t('realtime.liveSignals.subtitle') }}</p>
        </div>
        <div class="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition"
            :class="mode === 'signals' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'"
            @click="mode = 'signals'"
          >
            {{ t('realtime.liveSignals.modeStream') }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition"
            :class="mode === 'oee' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'"
            @click="mode = 'oee'"
          >
            {{ t('realtime.liveSignals.modeOee') }}
          </button>
        </div>
      </div>
    </div>
    <UnsLiveStateView v-if="mode === 'signals'" />
    <OeeMqttCockpitView v-else />
  </div>
</template>
