<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { patchMyUserSettings } from '@/api/auth'
import { i18n, isAppLocale, setI18nLocale } from '@/i18n'
import type { AppLocale } from '@/i18n'
import { themePreference } from '@/composables/useUiTheme'
import { navigationGroups } from '@/constants/rbac'

const { t } = useI18n()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const route = useRoute()
const router = useRouter()

const initials = computed(() => {
  const u = auth.user
  if (!u) return '?'
  const n = (u.displayName || `${u.firstName} ${u.lastName}`).trim()
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase()
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase()
  return 'U'
})

const displayHeaderName = computed(() => {
  const u = auth.user
  if (!u) return ''
  const d = u.displayName?.trim()
  if (d) return d
  return `${u.firstName} ${u.lastName}`.trim()
})

const headerLocaleValue = computed(() => {
  const u = auth.user
  if (u?.languageCode && isAppLocale(u.languageCode)) return u.languageCode
  return String(i18n.global.locale.value) as AppLocale
})

const isLight = computed(() => themePreference.value === 'light')

const routeTitle = computed(() => {
  const tk = route.meta.titleKey as string | undefined
  if (tk) return t(tk)
  return String(route.meta.title ?? '')
})

const shell = computed(() => {
  const L = isLight.value
  return {
    page: L ? 'bg-slate-100 text-slate-900' : 'bg-slate-950 text-slate-100',
    aside: L
      ? 'hidden w-[15rem] shrink-0 border-r border-slate-200 bg-white py-6 pl-3 pr-2 lg:block'
      : 'hidden w-[15rem] shrink-0 border-r border-slate-800 bg-slate-950/95 py-6 pl-3 pr-2 lg:block',
    brand: L ? 'font-display text-lg font-semibold text-slate-900' : 'font-display text-lg font-semibold text-white',
    tagline: 'mt-1 text-xs text-slate-500',
    sectionRule: L
      ? 'mb-1.5 mt-5 max-w-full border-t border-slate-200/90 pt-4 text-[10px] font-semibold uppercase leading-snug tracking-wider text-slate-500 first:mt-0 first:border-0 first:pt-0'
      : 'mb-1.5 mt-5 max-w-full border-t border-slate-800/90 pt-4 text-[10px] font-semibold uppercase leading-snug tracking-wider text-slate-500 first:mt-0 first:border-0 first:pt-0',
    navHover: L ? 'hover:bg-slate-200/80 hover:text-slate-900' : 'hover:bg-slate-800/80 hover:text-white',
    navActive: L ? 'bg-slate-200 text-slate-900' : 'bg-slate-800 text-white',
    navInactive: L ? 'text-slate-600' : 'text-slate-300',
    mobileHeader: L
      ? 'flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-100/90 px-4 py-3 backdrop-blur lg:hidden'
      : 'flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur lg:hidden',
    mobileBrand: L ? 'font-display text-sm font-semibold text-slate-900' : 'font-display text-sm font-semibold text-white',
    mobileNav: L ? 'rounded-md px-2 py-1 text-slate-600 hover:bg-slate-200' : 'rounded-md px-2 py-1 text-slate-300 hover:bg-slate-800',
    mobileNavActive: L ? 'bg-slate-200 text-slate-900' : 'bg-slate-800 text-white',
    desktopHeader: L
      ? 'flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-100/80 px-4 py-3 sm:px-6'
      : 'flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/80 px-4 py-3 sm:px-6',
    headerName: L ? 'truncate text-sm font-medium text-slate-900' : 'truncate text-sm font-medium text-white',
    select: L
      ? 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800'
      : 'rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200',
    signOut: L
      ? 'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-200'
      : 'rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800',
  }
})

type NavItem = {
  to: string
  labelKey: string
  activePathPrefix?: string
  activeExcludePrefixes?: string[]
  altActivePrefixes?: string[]
  exact?: boolean
  muted?: boolean
}

type NavSection = { id: string; titleKey: string; items: NavItem[] }

const navSections = computed((): NavSection[] => {
  const sections: NavSection[] = []

  for (const group of navigationGroups) {
    const items: NavItem[] = []
    for (const raw of group.items) {
      const rr = raw.requiredRoles
      if (Array.isArray(rr) && rr.length && !auth.canAny(rr)) continue
      const { resource, action } = raw.permission
      if (!auth.hasPermission(resource, action)) continue
      let labelKey = raw.labelKey
      const alt = raw.labelKeyIfPermission
      if (alt && auth.hasPermission(alt.resource, alt.action)) {
        labelKey = alt.labelKey
      }
      items.push({
        to: raw.to,
        labelKey,
        activePathPrefix: raw.activePathPrefix,
        activeExcludePrefixes: raw.activeExcludePrefixes,
        altActivePrefixes: raw.altActivePrefixes,
        exact: raw.exact,
        muted: raw.muted,
      })
    }
    if (items.length) {
      sections.push({ id: group.id, titleKey: group.titleKey, items })
    }
  }

  sections.push({
    id: 'personal',
    titleKey: 'nav.section.personal',
    items: [
      { to: '/help', labelKey: 'menu.help', activePathPrefix: '/help' },
      { to: '/settings', labelKey: 'menu.settings', exact: true },
    ],
  })

  return sections
})

const showParkSelector = computed(
  () => auth.isAuthenticated && auth.hasPermission('rides', 'read') && parkCtx.parks.length > 0
)

onMounted(async () => {
  if (auth.isAuthenticated && auth.hasPermission('rides', 'read')) {
    await parkCtx.hydrate()
  }
})

watch(
  () => auth.isAuthenticated,
  async (ok) => {
    if (ok && auth.hasPermission('rides', 'read')) await parkCtx.hydrate()
    else if (!ok) parkCtx.clearOnLogout()
  }
)

function onParkSelect(ev: Event) {
  const el = ev.target as HTMLSelectElement
  if (el.value) parkCtx.setActivePark(el.value)
}

function isNavItemActive(item: NavItem) {
  if (item.exact) return route.path === item.to
  if (route.path === item.to) return true
  if (item.activePathPrefix && route.path.startsWith(item.activePathPrefix)) {
    for (const ex of item.activeExcludePrefixes ?? []) {
      if (route.path.startsWith(ex)) return false
    }
    return true
  }
  for (const p of item.altActivePrefixes ?? []) {
    if (route.path.startsWith(p)) return true
  }
  return false
}

async function onHeaderLocale(ev: Event) {
  const el = ev.target as HTMLSelectElement
  const v = el.value
  if (!isAppLocale(v)) return
  setI18nLocale(v)
  try {
    const u = await patchMyUserSettings({ languageCode: v })
    auth.user = u
  } catch {
    /* offline or validation — UI locale already switched */
  }
}

async function onLogout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="flex min-h-screen" :class="shell.page">
    <aside :class="shell.aside">
      <div class="px-2">
        <p :class="shell.brand">{{ t('app.brand') }}</p>
        <p :class="shell.tagline">{{ t('app.tagline') }}</p>
      </div>
      <nav class="mt-6 flex flex-col gap-0">
        <template v-for="section in navSections" :key="section.id">
          <p :class="shell.sectionRule">
            {{ t(section.titleKey) }}
          </p>
          <div class="flex flex-col gap-px">
            <RouterLink
              v-for="item in section.items"
              :key="section.id + item.to + item.labelKey"
              :to="item.to"
              class="rounded-md px-2.5 py-1.5 text-[13px] font-medium leading-snug"
              :class="[
                shell.navHover,
                isNavItemActive(item) ? shell.navActive : shell.navInactive,
                item.muted ? 'text-slate-500 hover:text-slate-400' : '',
              ]"
            >
              {{ t(item.labelKey) }}
            </RouterLink>
          </div>
        </template>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="lg:hidden" :class="shell.mobileHeader">
        <p :class="shell.mobileBrand">{{ t('app.brand') }}</p>
        <nav class="flex max-h-[50vh] flex-col gap-3 overflow-y-auto pr-1 text-xs">
          <div v-for="section in navSections" :key="'m-' + section.id">
            <p class="mb-1 font-semibold uppercase tracking-wide text-slate-500">{{ t(section.titleKey) }}</p>
            <div class="flex flex-wrap gap-1.5">
              <RouterLink
                v-for="item in section.items"
                :key="section.id + item.to + item.labelKey"
                :to="item.to"
                :class="[shell.mobileNav, isNavItemActive(item) ? shell.mobileNavActive : '', item.muted ? 'text-slate-500' : '']"
              >
                {{ t(item.labelKey) }}
              </RouterLink>
            </div>
          </div>
        </nav>
      </header>

      <header :class="shell.desktopHeader">
        <div class="min-w-0">
          <p class="truncate text-xs uppercase tracking-wider text-slate-500">{{ routeTitle }}</p>
        </div>
        <div class="relative flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <template v-if="showParkSelector">
            <label class="sr-only" for="header-park">{{ t('nav.activePark') }}</label>
            <select
              id="header-park"
              :class="shell.select"
              :value="parkCtx.activeParkId ?? ''"
              @change="onParkSelect"
            >
              <option v-for="p in parkCtx.parks" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </template>
          <label class="sr-only" for="header-locale">{{ t('locale.label') }}</label>
          <select
            id="header-locale"
            :class="shell.select"
            :value="headerLocaleValue"
            @change="onHeaderLocale"
          >
            <option value="en">{{ t('locale.en') }}</option>
            <option value="de">{{ t('locale.de') }}</option>
            <option value="fr">{{ t('locale.fr') }}</option>
            <option value="es">{{ t('locale.es') }}</option>
          </select>
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 text-xs font-bold text-white"
          >
            {{ initials }}
          </div>
          <div class="hidden min-w-0 text-right sm:block">
            <p :class="shell.headerName">
              {{ displayHeaderName }}
            </p>
            <p class="truncate text-xs text-slate-500">{{ auth.user?.email }}</p>
          </div>
          <button type="button" :class="shell.signOut" @click="onLogout">
            {{ t('auth.signOut') }}
          </button>
        </div>
      </header>

      <main class="flex-1">
        <RouterView />
      </main>
    </div>
  </div>
</template>
