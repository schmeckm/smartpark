/** Map backend validation error strings to node ids when messages follow known patterns. */
export function parseValidationNodeIds(errors: string[] | undefined | null): Set<string> {
  const ids = new Set<string>()
  if (!errors?.length) return ids
  for (const err of errors) {
    if (!err || typeof err !== 'string') continue
    const nodePrefix = /node\s+([a-zA-Z0-9_-]+)/gi
    let m: RegExpExecArray | null
    while ((m = nodePrefix.exec(err))) {
      if (m[1] && m[1] !== '?') ids.add(m[1])
    }
    const edgeSrc = /edge source not found:\s*(\S+)/i.exec(err)
    if (edgeSrc?.[1]) ids.add(edgeSrc[1])
    const edgeTgt = /edge target not found:\s*(\S+)/i.exec(err)
    if (edgeTgt?.[1]) ids.add(edgeTgt[1])
    const dup = /duplicate node id:\s*(\S+)/i.exec(err)
    if (dup?.[1]) ids.add(dup[1])
  }
  return ids
}
