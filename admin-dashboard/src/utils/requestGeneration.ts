/** Ignore stale async results when inputs change (park switch, tab change, etc.). */
export function createRequestGeneration() {
  let generation = 0
  return {
    next(): number {
      generation += 1
      return generation
    },
    isStale(id: number): boolean {
      return id !== generation
    },
  }
}
