import { Effect, Ref as R } from 'effect'

export const aliasedImportUpdate = (ref: R.Ref<number>): Effect.Effect<void> => R.update(ref, (n) => n + 1)
