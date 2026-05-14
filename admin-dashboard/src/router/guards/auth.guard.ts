import type { NavigationGuardWithThis } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * Bootstraps the auth session and gates non-public routes.
 * Public routes (e.g. /login) are passed through; unauthenticated requests
 * are redirected to /login with a `?redirect=` back-pointer.
 */
export const authGuard: NavigationGuardWithThis<undefined> = async (to) => {
  const auth = useAuthStore()
  if (!auth.bootstrapped) {
    await auth.bootstrap()
  }
  if (to.meta.public) return true
  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
}
