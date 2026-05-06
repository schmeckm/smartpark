/**
 * Mirrors `src/modules/uns/sparkplug-topic-builder.service.js` for UNS Topics UI (no server import).
 */

export const SPARKPLUG_MESSAGE_TYPES_ALL = [
  'NBIRTH',
  'NDEATH',
  'DBIRTH',
  'DDEATH',
  'DDATA',
  'NCMD',
  'DCMD',
  'STATE',
] as const

export type SparkplugMessageTypeAll = (typeof SPARKPLUG_MESSAGE_TYPES_ALL)[number]

const DEVICE_MESSAGE_TYPES = new Set(['DBIRTH', 'DDEATH', 'DDATA', 'DCMD'])

export function slugifyName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function sanitizeTopicSegment(value: string | undefined | null, fallback: string): string {
  const s = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const out = s.slice(0, 120)
  return out || fallback
}

export function buildSparkplugTopic(p: {
  groupId: string
  messageType: string
  edgeNodeId: string
  deviceId?: string | null
}): string {
  const mtRaw = String(p.messageType || 'DDATA').trim().toUpperCase()
  if (!(SPARKPLUG_MESSAGE_TYPES_ALL as readonly string[]).includes(mtRaw)) {
    throw new Error(`Invalid Sparkplug messageType: ${p.messageType}`)
  }
  const g = sanitizeTopicSegment(p.groupId, 'smartpark')
  const edge = sanitizeTopicSegment(p.edgeNodeId, 'park_gateway')
  const parts = ['spBv1.0', g, mtRaw, edge]
  const needsDevice = DEVICE_MESSAGE_TYPES.has(mtRaw)
  const devRaw = p.deviceId != null && String(p.deviceId).trim() !== '' ? String(p.deviceId) : ''
  const dev = sanitizeTopicSegment(slugifyName(devRaw), '')
  if (needsDevice) {
    if (!dev) throw new Error(`deviceId required for ${mtRaw}`)
    parts.push(dev)
  }
  return parts.join('/')
}

export const SPARKPLUG_COMPACT_DEVICE_TYPES = ['DBIRTH', 'DDATA', 'DDEATH'] as const
export const SPARKPLUG_ADVANCED_EXTRA_TYPES = ['NBIRTH', 'NDEATH', 'NCMD', 'DCMD', 'STATE'] as const
