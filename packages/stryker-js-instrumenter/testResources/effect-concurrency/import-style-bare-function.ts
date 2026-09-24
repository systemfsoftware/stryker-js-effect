import { Effect, Ref } from 'effect'
import { update } from 'effect/Ref'

export const bareFunctionUpdate = (ref: Ref.Ref<number>): Effect.Effect<void> => update(ref, (n) => n + 1)
