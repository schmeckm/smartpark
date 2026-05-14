<script setup lang="ts">
import { RouterLink } from 'vue-router'
import GlobalStatusFooter from '@/components/layout/GlobalStatusFooter.vue'
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <div class="flex flex-1 flex-col items-center justify-center px-4 pb-10 text-center">
      <p class="font-display text-2xl font-semibold text-white">Access denied</p>
      <p class="mt-2 max-w-md text-sm text-slate-400">
        Your role does not include permission for this area. Contact an administrator if you need access.
      </p>
      <RouterLink
        to="/"
        class="mt-6 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500"
      >
        Back to operations
      </RouterLink>
    </div>
    <GlobalStatusFooter />
  </div>
</template>
