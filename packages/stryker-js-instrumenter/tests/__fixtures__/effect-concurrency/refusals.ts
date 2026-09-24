import { Effect, Ref } from 'effect'
import { type Cell, update } from './local-ref.js'

export const localUpdateRefusal = (cell: Cell<number>) => update(cell, (n) => n + 1)

export const localDeclarationRefusal = (ref: Ref.Ref<number>) => {
  const update = (r: Ref.Ref<number>, f: (n: number) => number): Effect.Effect<void> => Ref.set(r, f(0))
  return update(ref, (n) => n + 1)
}

export const parameterShadowRefusal = (
  Ref: { readonly update: (ref: Ref.Ref<number>, f: (n: number) => number) => Effect.Effect<void> },
  ref: Ref.Ref<number>,
) => Ref.update(ref, (n) => n + 1)

export const dataLastOutsidePipeRefusal = (): readonly [(ref: Ref.Ref<number>) => Effect.Effect<void>] => {
  const step = Ref.update((n: number) => n + 1)
  return [step]
}

export const nestedCoveredCalls = (effect: Effect.Effect<number>, flag: Ref.Ref<boolean>) =>
  Effect.ensuring(Effect.onInterrupt(effect, () => Ref.set(flag, true)), Ref.set(flag, true))
