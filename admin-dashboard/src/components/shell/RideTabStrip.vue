<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'

interface RideTab {
  name: string
  labelKey: string
  permission?: { resource: string; action: string }
}

const props = defineProps<{
  tabs: RideTab[]
  rideId: string
}>()

const route = useRoute()
const auth = useAuthStore()
const { t } = useI18n()

const visibleTabs = computed(() =>
  props.tabs.filter((tab) => {
    if (!tab.permission) return true
    return auth.hasPermission(tab.permission.resource, tab.permission.action)
  }),
)

function isActive(tabName: string) {
  return route.name === tabName
}
</script>

<template>
  <nav class="flex gap-1 overflow-x-auto border-b border-slate-800 bg-slate-950/40 px-4" aria-label="Ride tabs">
    <RouterLink
      v-for="tab in visibleTabs"
      :key="tab.name"
      :to="{ name: tab.name, params: { rideId } }"
      class="whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors"
      :class="
        isActive(tab.name)
          ? 'border-brand-500 text-white'
          : 'border-transparent text-slate-400 hover:border-slate-600 hover:text-slate-200'
      "
    >
      {{ t(tab.labelKey) }}
    </RouterLink>
  </nav>
</template>
