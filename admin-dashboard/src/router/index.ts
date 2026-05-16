import { createRouter, createWebHistory } from 'vue-router'
import { i18n } from '@/i18n'

import { authGuard } from '@/router/guards/auth.guard'
import { personaGuard } from '@/router/guards/persona.guard'
import { rbacGuard } from '@/router/guards/rbac.guard'

import { opsRoutes } from '@/router/domains/ops.routes'
import { realtimeRoutes } from '@/router/domains/realtime.routes'
import { aiRoutes } from '@/router/domains/ai.routes'
import { assetsRoutes } from '@/router/domains/assets.routes'
import { adminRoutes } from '@/router/domains/admin.routes'
import { diagnosticsRoutes } from '@/router/domains/diagnostics.routes'

declare module 'vue-router' {
  interface RouteMeta {
    /** If set, user must have at least one of these role codes (in addition to `permission` when present). */
    roles?: string[]
    /** i18n key for document title + header (e.g. `settings.title`). */
    titleKey?: string
    /** RBAC gate for this route. */
    permission?: { resource: string; action: string }
    /** User needs at least one of these permissions (OR). When set, `permission` on the same record is ignored. */
    permissionsAny?: { resource: string; action: string }[]
    /** Public (no auth) marker. */
    public?: boolean
    /** F2-MVP top-level domain for persona / sidebar / breadcrumb resolution. */
    domain?: 'operations' | 'realtime' | 'ai' | 'assets' | 'admin'
    /** When true, `personaGuard` requires `domain` to be listed in the user's persona `navDomains`. */
    enforcePersonaDomain?: boolean
    /** When set, `rbacGuard` requires this adapter key in `useInstalledAdaptersStore` (after hydrate). */
    requiresInstalledAdapter?: string
    /** When set, at least one of these adapter keys must be installed (OR). Checked after hydrate. */
    requiresAnyInstalledAdapters?: string[]
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: 'Sign in' },
    },
    {
      path: '/unauthorized',
      name: 'unauthorized',
      component: () => import('@/views/UnauthorizedView.vue'),
      meta: { title: 'Unauthorized' },
    },
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      children: [
        ...opsRoutes,
        ...realtimeRoutes,
        ...aiRoutes,
        ...assetsRoutes,
        ...adminRoutes,
        ...diagnosticsRoutes,
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(authGuard)
router.beforeEach(personaGuard)
router.beforeEach(rbacGuard)

router.afterEach((to) => {
  const tk = to.meta.titleKey as string | undefined
  const title = tk
    ? String(i18n.global.t(tk))
    : ((to.meta.title as string) || 'Smart Park OS')
  document.title = `${title} · Smart Park OS`
})

export default router
