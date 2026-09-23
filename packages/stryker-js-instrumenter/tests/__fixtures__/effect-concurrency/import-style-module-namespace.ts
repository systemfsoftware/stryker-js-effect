import * as Effect from 'effect/Effect'
import * as Ref from 'effect/Ref'

export const moduleNamespaceUpdate = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)
