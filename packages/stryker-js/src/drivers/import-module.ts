import * as Effect from 'effect/Effect'

import { StrykerError } from '../stryker-error.schema.js'

export function importModule<A = unknown>(moduleName: string): Effect.Effect<A, StrykerError> {
  return Effect.tryPromise({
    try: (): Promise<A> => import(moduleName),
    catch: (cause) => StrykerError.make({ message: `Failed to import module "${moduleName}"`, cause }),
  })
}
