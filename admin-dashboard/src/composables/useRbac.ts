import { useAuthStore } from '@/stores/auth'

/**
 * Role helpers for templates and guards (`can` = user has this role code).
 */
export function useRbac() {
  const auth = useAuthStore()
  return {
    can: (role: string) => auth.can(role),
    canAny: (roles: string[]) => auth.canAny(roles),
  }
}
