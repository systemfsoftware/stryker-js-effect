import { Effect, Ref } from 'effect'

export const namedImportUpdate = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)
