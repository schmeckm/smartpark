import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuthUser, LoginResult } from '@/types/auth'
import { rolesHavePermission } from '@/constants/rbac'
import { login as apiLogin, logout as apiLogout, getMe, refreshWithRefreshToken } from '@/api/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { useInstalledAdaptersStore } from '@/stores/installedAdapters'
import { resolveLocaleFromUser, setI18nLocale } from '@/i18n'

const ACCESS = 'sp_access_token'
const REFRESH = 'sp_refresh_token'

function applyLocaleFromUser(u: AuthUser | null) {
  if (!u) return
  setI18nLocale(resolveLocaleFromUser(u.languageCode))
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(localStorage.getItem(ACCESS))
  const refreshToken = ref<string | null>(localStorage.getItem(REFRESH))
  const user = ref<AuthUser | null>(null)
  const bootstrapped = ref(false)

  const isAuthenticated = computed(() => Boolean(accessToken.value))

  function setTokens(access: string | null, refresh: string | null) {
    accessToken.value = access
    refreshToken.value = refresh
    if (access) localStorage.setItem(ACCESS, access)
    else localStorage.removeItem(ACCESS)
    if (refresh) localStorage.setItem(REFRESH, refresh)
    else localStorage.removeItem(REFRESH)
  }

  function clearSession() {
    setTokens(null, null)
    user.value = null
    bootstrapped.value = false
    useParkContextStore().clearOnLogout()
    useInstalledAdaptersStore().clearOnLogout()
  }

  async function bootstrap() {
    if (!accessToken.value) {
      bootstrapped.value = true
      return
    }
    try {
      user.value = await getMe()
      applyLocaleFromUser(user.value)
    } catch (e) {
      const status = (e as Error & { status?: number }).status
      const rt = refreshToken.value
      if (status === 401 && rt) {
        try {
          const data = await refreshWithRefreshToken(rt)
          setTokens(data.accessToken, data.refreshToken)
          user.value = data.user
          applyLocaleFromUser(user.value)
        } catch {
          clearSession()
        }
      } else {
        clearSession()
      }
    } finally {
      bootstrapped.value = true
    }
  }

  async function login(email: string, password: string) {
    const data: LoginResult = await apiLogin(email, password)
    setTokens(data.accessToken, data.refreshToken)
    user.value = data.user
    bootstrapped.value = true
    applyLocaleFromUser(data.user)
  }

  async function logout() {
    try {
      await apiLogout(refreshToken.value)
    } catch {
      /* ignore */
    }
    clearSession()
  }

  function hasPermission(resource: string, action: string) {
    if (!user.value?.roles?.length) return false
    return rolesHavePermission(user.value.roles, resource, action)
  }

  function can(role: string) {
    return Boolean(user.value?.roles?.includes(role))
  }

  function canAny(roles: string[]) {
    if (!user.value?.roles?.length) return false
    return roles.some((r) => user.value!.roles.includes(r))
  }

  return {
    accessToken,
    refreshToken,
    user,
    bootstrapped,
    isAuthenticated,
    login,
    logout,
    bootstrap,
    hasPermission,
    can,
    canAny,
    clearSession,
  }
})
