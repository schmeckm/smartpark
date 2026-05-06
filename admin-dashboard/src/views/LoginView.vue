<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'

const email = ref('admin@smartpark.com')
const password = ref('Smartpark123!')
const busy = ref(false)
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const { push } = useToast()

async function submit() {
  busy.value = true
  try {
    await auth.login(email.value.trim(), password.value)
    push('Signed in successfully', 'success')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect || '/')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Login failed', 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-950 px-4">
    <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-panel">
      <div class="mb-8 text-center">
        <div
          class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-indigo-600 font-display text-lg font-bold text-white"
        >
          SP
        </div>
        <h1 class="font-display text-2xl font-semibold text-white">Sign in</h1>
        <p class="mt-2 text-sm text-slate-400">Smart Park OS operations console</p>
      </div>
      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-400" for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="username"
            required
            class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-brand-500 focus:ring-2"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-400" for="pw">Password</label>
          <input
            id="pw"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-brand-500 focus:ring-2"
          />
        </div>
        <button
          type="submit"
          class="mt-2 w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
          :disabled="busy"
        >
          {{ busy ? 'Signing in…' : 'Continue' }}
        </button>
      </form>
      <p class="mt-6 text-center text-xs text-slate-500">
        Demo accounts share password <span class="text-slate-400">Smartpark123!</span> — admin@, operator@, viewer@,
        operations@, security@ @smartpark.com
      </p>
    </div>
  </div>
</template>
