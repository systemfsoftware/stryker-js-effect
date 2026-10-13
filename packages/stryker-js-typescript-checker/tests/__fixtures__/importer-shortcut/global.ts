declare global {
  interface ShortcutProbe {
    readonly probe: number
  }
}

export function widen(x: number): number {
  return x + 2
}
