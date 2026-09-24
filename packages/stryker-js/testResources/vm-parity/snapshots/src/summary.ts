export interface Widget {
  readonly kind: string
  readonly size: number
}

export const widget = (kind: string, size: number): Widget => ({ kind, size })

export const manifest = (): Record<string, number> => ({ alpha: 1, beta: 2 })
