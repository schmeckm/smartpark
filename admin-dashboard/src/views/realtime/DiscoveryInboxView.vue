<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import UnsSpyInboxView from '@/views/UnsSpyInboxView.vue'

const { t } = useI18n()
</script>

<template>
  <div class="min-h-full">
    <div class="border-b border-slate-800 bg-slate-900/40 px-4 sm:px-6">
      <div class="pb-3 pt-4">
        <h1 class="font-display text-lg font-semibold text-white">{{ t('realtime.discovery.title') }}</h1>
        <p class="mt-0.5 text-xs text-slate-500">{{ t('realtime.discovery.subtitle') }}</p>
      </div>
    </div>
    <UnsSpyInboxView />
  </div>
</template>
