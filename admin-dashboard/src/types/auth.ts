export type UserDateFormat = 'DD.MM.YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY'
export type UserTimeFormat = '24h' | '12h'

/** Optional UI prefs (JSON); e.g. park map frequency thresholds. */
export type UserUiPreferences = {
  parkMapFreqThresholds?: {
    veryHighMin?: number
    mediumMin?: number
    lowMin?: number
  }
}

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  displayName?: string | null
  roles: string[]
  languageCode: string
  /** IANA zone or null → browser default in UI */
  timezone?: string | null
  dateFormat?: UserDateFormat
  timeFormat?: UserTimeFormat
  /** BCP-47, e.g. de-DE; null → derived from languageCode */
  locale?: string | null
  uiPreferences?: UserUiPreferences | Record<string, unknown> | null
  active: boolean
  lastLoginAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  expiresIn: string
  user: AuthUser
}

export interface AuditLogRow {
  id: string
  userId: string | null
  action: string
  entityType: string | null
  entityId: string | null
  oldValue: unknown
  newValue: unknown
  ipAddress: string | null
  createdAt?: string
  user?: Partial<AuthUser>
}
