/** Synced with park context store — avoids Pinia↔api circular imports. */
let activeParkId: string | null = null

export function setApiParkContextId(id: string | null) {
  activeParkId = id && String(id).trim() !== '' ? String(id).trim() : null
}

export function getApiParkContextId(): string | null {
  return activeParkId
}

export function apiParkHeaders(): Record<string, string> {
  if (!activeParkId) return {}
  return { 'X-Park-Id': activeParkId }
}
