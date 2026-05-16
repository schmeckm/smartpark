import { ref, watch, type Ref } from 'vue'

const STORAGE_PREFIX = 'sp-integration-flow-pinned:'

function storageKey(flowId: string, nodeId: string): string {
  return `${STORAGE_PREFIX}${flowId}:${nodeId}`
}

/**
 * Local-only pinned example payloads per flow node (MVP — not persisted to backend).
 */
export function useIntegrationFlowPinnedPayload(flowId: Ref<string | null>) {
  const revision = ref(0)

  function bump() {
    revision.value += 1
  }

  function getPinned(nodeId: string): unknown | null {
    void revision.value
    const fid = flowId.value?.trim()
    if (!fid || !nodeId) return null
    try {
      const raw = localStorage.getItem(storageKey(fid, nodeId))
      if (!raw) return null
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }

  function setPinned(nodeId: string, payload: unknown) {
    const fid = flowId.value?.trim()
    if (!fid || !nodeId) return
    try {
      localStorage.setItem(storageKey(fid, nodeId), JSON.stringify(payload))
      bump()
    } catch {
      /* quota / private mode */
    }
  }

  function clearPinned(nodeId: string) {
    const fid = flowId.value?.trim()
    if (!fid || !nodeId) return
    try {
      localStorage.removeItem(storageKey(fid, nodeId))
      bump()
    } catch {
      /* */
    }
  }

  watch(flowId, () => bump())

  return { getPinned, setPinned, clearPinned, revision }
}
