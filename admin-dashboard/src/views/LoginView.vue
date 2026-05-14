<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import GlobalStatusFooter from '@/components/layout/GlobalStatusFooter.vue'

const email = ref('admin@smartpark.com')
const password = ref('Smartpark123!')
const busy = ref(false)
const remember = ref(false)
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const { push } = useToast()

/** Meta + inline script in `index.html` use Vite `%VITE_LOGIN_HERO_IMAGE%`; then `import.meta.env` (see vite `define`). */
function resolveLoginHeroUrl(): string {
  const sanitize = (raw: string) => {
    const t = raw.trim()
    if (!t || t.startsWith('%VITE_')) return ''
    return t
  }
  if (typeof document !== 'undefined') {
    const fromMeta = sanitize(document.querySelector('meta[name="smartpark-login-hero"]')?.getAttribute('content') || '')
    if (fromMeta) return fromMeta
  }
  const w = globalThis.window
  const boot = w && typeof w.__SP_LOGIN_HERO__ === 'string' ? sanitize(w.__SP_LOGIN_HERO__) : ''
  const fromEnv = sanitize((import.meta.env.VITE_LOGIN_HERO_IMAGE as string | undefined) || '')
  return boot || fromEnv
}

/** Optional: absolute URL or path under `public/` (e.g. `/login-hero.jpg`). Left column uses cover/center. */
const heroImageUrl = resolveLoginHeroUrl()

/** Safe `url("...")` for inline styles (handles spaces and quotes in path). */
const heroBackgroundImage = computed(() =>
  heroImageUrl ? `url(${JSON.stringify(heroImageUrl)})` : undefined
)

/** Left column: only a gradient fallback when no hero; with hero, full-page image is the backdrop (glass panel here). */
const heroPanelStyle = computed(() => {
  if (heroImageUrl) return {}
  const bg = heroBackgroundImage.value
  if (!bg) return {}
  return {
    backgroundImage: bg,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  }
})

const greetingLine = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
})

const siteLine = computed(() => {
  const w = globalThis.window
  if (!w) return 'Smart Park OS'
  return w.location.host || 'Smart Park OS'
})

onMounted(() => {
  try {
    const saved = localStorage.getItem('loginRememberEmail')
    if (saved) {
      remember.value = true
      email.value = saved
    }
  } catch {
    /* ignore */
  }
})

async function submit() {
  busy.value = true
  try {
    if (remember.value) {
      try {
        localStorage.setItem('loginRememberEmail', email.value.trim())
      } catch {
        /* ignore */
      }
    } else {
      try {
        localStorage.removeItem('loginRememberEmail')
      } catch {
        /* ignore */
      }
    }
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
  <!-- Login backdrop: full-page hero + light slate wash + translucent card (product baseline; keep photo visible). -->
  <div class="login-page-root relative flex min-h-screen flex-col overflow-x-hidden bg-slate-950 font-sans">
    <!-- Full-page hero (same asset as optional left branding); wash below stays light on purpose -->
    <div
      v-if="heroBackgroundImage"
      class="pointer-events-none absolute inset-0"
      :style="{
        backgroundImage: heroBackgroundImage,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute inset-0"
      :class="
        heroBackgroundImage
          ? 'bg-gradient-to-br from-slate-950/35 via-slate-950/22 to-slate-950/30'
          : 'bg-slate-950'
      "
      aria-hidden="true"
    />

    <div class="relative z-10 flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
      <div
        class="grid w-full max-w-[920px] overflow-hidden rounded-2xl border border-slate-800/55 bg-slate-900/18 shadow-panel backdrop-blur-sm md:grid-cols-2 md:min-h-[440px]"
      >
        <!-- Left: glass + brand when hero is full-page; else gradient / inline hero -->
        <div
          class="relative flex min-h-[200px] flex-col justify-between md:min-h-0"
          :class="[
            heroImageUrl
              ? 'bg-slate-950/5 md:bg-transparent'
              : 'bg-cover bg-center bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900/25',
          ]"
          :style="heroPanelStyle"
        >
          <div
            class="absolute inset-0 bg-gradient-to-t to-transparent"
            :class="
              heroImageUrl
                ? 'from-slate-950/20 via-transparent'
                : 'from-slate-950/80 via-slate-950/35 md:from-slate-950/85'
            "
            aria-hidden="true"
          />
          <div class="relative z-10 flex flex-1 flex-col justify-center px-8 pb-6 pt-10 md:pb-10 md:pt-12">
            <div
              class="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-indigo-600 font-display text-lg font-bold text-white shadow-lg"
            >
              SP
            </div>
            <h2 class="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Sign in
            </h2>
            <p class="mt-2 max-w-xs text-sm text-slate-400">
              Smart Park OS operations console
            </p>
          </div>
          <div class="relative z-10 mt-auto px-8 pb-5">
            <div
              class="rounded-t-xl border border-b-0 border-slate-700/60 bg-slate-950/55 px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500"
            >
              {{ siteLine }}
            </div>
          </div>
        </div>

        <!-- Right: form (slate / brand like original card) -->
        <div
          class="flex flex-col justify-center border-t border-slate-800/70 bg-slate-950/22 px-8 py-10 sm:px-10 sm:py-12 md:border-l md:border-t-0"
        >
          <div class="mb-8">
            <p class="text-sm font-medium text-slate-400">Hello!</p>
            <p class="font-display mt-1 text-2xl font-semibold text-white">
              {{ greetingLine }}
            </p>
            <p class="mt-2 text-right text-sm font-medium text-brand-400">Login to your account</p>
          </div>

          <form class="space-y-6" @submit.prevent="submit">
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="email">Email</label>
              <div class="login-field-line">
                <input
                  id="email"
                  v-model="email"
                  data-testid="login-email"
                  type="email"
                  autocomplete="username"
                  required
                  class="login-input-line"
                />
              </div>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-slate-400" for="pw">Password</label>
              <div class="login-field-line">
                <input
                  id="pw"
                  v-model="password"
                  data-testid="login-password"
                  type="password"
                  autocomplete="current-password"
                  required
                  class="login-input-line"
                />
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 text-xs text-slate-500">
              <label class="flex cursor-pointer items-center gap-2 select-none">
                <input
                  v-model="remember"
                  type="checkbox"
                  class="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 text-brand-600 focus:ring-brand-500"
                />
                Remember
              </label>
              <span class="text-slate-500">Forgot password?</span>
            </div>

            <button
              type="submit"
              data-testid="login-submit"
              class="mt-2 w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-panel hover:bg-brand-500 disabled:opacity-50"
              :disabled="busy"
            >
              {{ busy ? 'Signing in…' : 'Continue' }}
            </button>
          </form>

          <p class="mt-8 text-center text-xs text-slate-500">
            Demo accounts share password <span class="text-slate-400">Smartpark123!</span> — admin@, operator@, viewer@,
            operations@, security@ @smartpark.com
          </p>
        </div>
      </div>
    </div>

    <GlobalStatusFooter />
  </div>
</template>

<style scoped>
.login-field-line {
  position: relative;
  padding-bottom: 2px;
}

.login-field-line::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  border-radius: 9999px;
  background: linear-gradient(90deg, #145be1 0%, #3291ff 55%, #59b0ff 100%);
  pointer-events: none;
}

.login-input-line {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0.5rem 0 0.35rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: rgb(248 250 252);
  outline: none;
  box-shadow: none;
}

.login-input-line:focus {
  outline: none;
  box-shadow: none;
}
</style>
