/** Must match `SUPPORTED_DOMAINS` in backend `topic-layout.constants.js`. */
export const UNS_EXTENSION_DOMAINS = [
  'operations',
  'queue',
  'green',
  'maintenance',
  'weather',
  'guestflow',
  'staffing',
  'safety',
] as const

export type UnsExtensionDomain = (typeof UNS_EXTENSION_DOMAINS)[number]
