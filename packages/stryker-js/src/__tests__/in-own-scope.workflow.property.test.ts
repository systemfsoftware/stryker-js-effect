import { describe, it } from '@systemfsoftware/vitest'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Match from 'effect/Match'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'

import { inOwnScope } from '../Checker/checker-pool.handle.js'
import { StageError } from '../Run.schema.js'

const holds = (conditions: readonly boolean[]) => conditions.every((condition) => condition)

const backgroundReleaseVerdictOf = (observed: {
  readonly beforeRelease: number
  readonly afterRelease: number
  readonly afterScope: number
}) => holds([observed.beforeRelease === 0, observed.afterRelease === 1, observed.afterScope === 1])

const failedReleaseVerdictOf = (observed: { readonly failed: boolean; readonly released: number }) =>
  holds([observed.failed, observed.released === 1])

describe('inOwnScope', () => {
  it.effect.prop(
    '∀mode_CheckerRelease_⊨Once',
    { of: [S.Literals(['finished', 'failed', 'interrupted'])], subject: inOwnScope },
    (subject, [mode]) =>
      Effect.gen(function*() {
        const released = yield* Ref.make(0)
        const acquire = Effect.addFinalizer(() => Ref.update(released, (n) => n + 1))
        const afterFinished = () =>
          Effect.gen(function*() {
            const inside = yield* Effect.scoped(
              Effect.gen(function*() {
                const checker = yield* subject(acquire)
                const beforeRelease = yield* Ref.get(released)
                const release = yield* checker.releaseInBackground
                yield* Fiber.await(release)
                return { beforeRelease, afterRelease: yield* Ref.get(released) }
              }),
            )
            const afterScope = yield* Ref.get(released)
            return backgroundReleaseVerdictOf({ ...inside, afterScope })
          })
        const afterFailed = () =>
          Effect.gen(function*() {
            const failed = Effect.andThen(
              subject(acquire),
              Effect.fail(StageError.make({ stage: 'mutationTest', reason: 'the checks failed' })),
            )
            const outcome = yield* Effect.scoped(failed).pipe(Effect.exit)
            const releasedAfter = yield* Ref.get(released)
            return failedReleaseVerdictOf({ failed: Exit.isFailure(outcome), released: releasedAfter })
          })
        const afterInterrupted = () =>
          Effect.gen(function*() {
            const checking = yield* Deferred.make<void>()
            const acquired = yield* Deferred.make<void>()
            const fiber = yield* Effect.gen(function*() {
              yield* subject(acquire)
              yield* Deferred.succeed(acquired, undefined)
              yield* Deferred.await(checking)
            }).pipe(Effect.scoped, Effect.forkChild)
            yield* Deferred.await(acquired)
            yield* Fiber.interrupt(fiber)
            const releasedAfterInterrupt = yield* Ref.get(released)
            return releasedAfterInterrupt === 1
          })
        const verdict = yield* Match.value(mode).pipe(
          Match.when('finished', () => afterFinished()),
          Match.when('failed', () => afterFailed()),
          Match.when('interrupted', () => afterInterrupted()),
          Match.exhaustive,
        )
        return verdict
      }),
  )
})
