<script setup lang="ts">
import { RouterView } from 'vue-router'
import ConfirmDialogHost from '@/components/ConfirmDialogHost.vue'
import ToastStack from '@/components/ToastStack.vue'
</script>

<template>
  <RouterView />
  <ToastStack />
  <ConfirmDialogHost />
</template>
