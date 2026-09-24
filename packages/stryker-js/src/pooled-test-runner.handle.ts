import {
  type DryRunOptions,
  type DryRunResult,
  type MutantRunOptions,
  type MutantRunResult,
  type StrykerOptions,
  type TestRunnerCapabilities,
  WallClockTimeoutReason,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Cause from 'effect/Cause'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import { type Pipeable, Prototype } from 'effect/Pipeable'
import * as Predicate from 'effect/Predicate'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import type { PooledTestRunnerError } from './TestRunner.schema.js'
import { OutOfMemoryError } from './Worker.schema.js'

export const TypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/PooledTestRunner')
export type TypeId = typeof TypeId

export interface PooledTestRunner extends Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly capabilities: Effect.Effect<TestRunnerCapabilities, PooledTestRunnerError>
  readonly init: Effect.Effect<void, PooledTestRunnerError>
  readonly dryRun: (options: DryRunOptions) => Effect.Effect<DryRunResult, PooledTestRunnerError>
  readonly mutantRun: (options: MutantRunOptions) => Effect.Effect<MutantRunResult, PooledTestRunnerError>
}

export const isPooledTestRunner = (u: unknown): u is PooledTestRunner => Predicate.hasProperty(u, TypeId)

export const make = (runner: {
  readonly capabilities: Effect.Effect<TestRunnerCapabilities, PooledTestRunnerError>
  readonly init: Effect.Effect<void, PooledTestRunnerError>
  readonly dryRun: (options: DryRunOptions) => Effect.Effect<DryRunResult, PooledTestRunnerError>
  readonly mutantRun: (options: MutantRunOptions) => Effect.Effect<MutantRunResult, PooledTestRunnerError>
}): PooledTestRunner => ({
  [TypeId]: TypeId,
  ...Prototype,
  ...runner,
})

type RunPolicy<A, E> = (self: Effect.Effect<A, E, never>) => Effect.Effect<A, E, never>

export const withTimeout: {
  (inner: PooledTestRunner): PooledTestRunner
} = (inner) => ({
  ...inner,
  dryRun: (options) =>
    inner.dryRun(options).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(options.timeout),
        orElse: (): Effect.Effect<DryRunResult> =>
          Effect.succeed({ status: 'timeout', reason: WallClockTimeoutReason.literal }),
      }),
    ),
  mutantRun: (options) =>
    inner.mutantRun(options).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(options.timeout),
        orElse: (): Effect.Effect<MutantRunResult> =>
          Effect.succeed({ status: 'timeout', reason: WallClockTimeoutReason.literal }),
      }),
    ),
})

export const invalidatesRunnerPool: {
  (status: string, reason: string | undefined): boolean
  (reason: string | undefined): (status: string) => boolean
} = dual(
  2,
  (status: string, reason: string | undefined): boolean =>
    status === 'timeout' && reason === WallClockTimeoutReason.literal,
)
const maxRetries = 2

const exhaustedMessage = (cause: Cause.Cause<PooledTestRunnerError>) =>
  `Test runner crashed. Tried ${maxRetries} times to restart it without any luck. ${Cause.pretty(cause)}`

export const withRetry: {
  (inner: PooledTestRunner): PooledTestRunner
} = (inner) => {
  const attempt = <A>(
    run: Effect.Effect<A, PooledTestRunnerError>,
    onExhausted: (message: string) => A,
  ): Effect.Effect<A> =>
    run.pipe(
      Effect.tapError((error) =>
        Match.value(error).pipe(
          Match.when(S.is(OutOfMemoryError), (outOfMemory) =>
            Effect.logInfo(
              `Test runner process [${outOfMemory.pid}] ran out of memory. That usually means the tests leak memory. Stryker restarts the process and carries on, but the run is slower for it.`,
            )),
          Match.orElse(() => Effect.void),
        )
      ),
      Effect.retry({ times: maxRetries }),
      Effect.catchCause((cause) => Effect.succeed(onExhausted(exhaustedMessage(cause)))),
    )
  return {
    ...inner,
    dryRun: (options) =>
      attempt(inner.dryRun(options), (errorMessage) => ({
        status: 'error',
        errorMessage,
      })),
    mutantRun: (options) =>
      attempt(inner.mutantRun(options), (errorMessage) => ({
        status: 'error',
        errorMessage,
      })),
  }
}

export const withMaxReuse: {
  (options: Pick<StrykerOptions, 'maxTestRunnerReuse'>, retire: Effect.Effect<void>): (
    inner: PooledTestRunner,
  ) => Effect.Effect<PooledTestRunner>
  (retire: Effect.Effect<void>): (
    options: Pick<StrykerOptions, 'maxTestRunnerReuse'>,
  ) => (inner: PooledTestRunner) => Effect.Effect<PooledTestRunner>
} = dual(
  2,
  (
    options: Pick<StrykerOptions, 'maxTestRunnerReuse'>,
    retire: Effect.Effect<void>,
  ): (inner: PooledTestRunner) => Effect.Effect<PooledTestRunner> =>
  (inner) =>
    Match.value(options.maxTestRunnerReuse).pipe(
      Match.when((restartAfter) => restartAfter <= 0, () => Effect.succeed(inner)),
      Match.orElse((restartAfter) =>
        Effect.gen(function*() {
          const runs = yield* Ref.make(0)

          return {
            ...inner,
            mutantRun: (runOptions: MutantRunOptions) => {
              const policy: RunPolicy<MutantRunResult, PooledTestRunnerError> = (self) =>
                Effect.gen(function*() {
                  const count = yield* Ref.updateAndGet(runs, (n) => n + 1)
                  yield* Boolean.match(count > restartAfter, {
                    onTrue: () => Effect.andThen(retire, Ref.set(runs, 1)),
                    onFalse: () => Effect.void,
                  })
                  return yield* self
                })
              return policy(inner.mutantRun(runOptions))
            },
          }
        })
      ),
    ),
)

type EnvironmentState = 'pristine' | 'loaded' | 'loaded-static-mutant'

const nextEnvironmentState = (requested: boolean): EnvironmentState =>
  Boolean.match(requested, {
    onTrue: (): EnvironmentState => 'loaded-static-mutant',
    onFalse: (): EnvironmentState => 'loaded',
  })

const reloadEnvironmentDecision = (
  requested: MutantRunOptions['reloadEnvironment'],
  current: EnvironmentState,
  canReload: boolean,
) => canReload && stateNeedsReload(requested, current)

const stateNeedsReload = (requested: boolean, current: EnvironmentState): boolean =>
  Match.value(requested).pipe(
    Match.when(true, () => current !== 'pristine'),
    Match.orElse(() => current === 'loaded-static-mutant'),
  )

const retireDecision = (current: EnvironmentState, canReload: boolean) =>
  !canReload && current === 'loaded-static-mutant'

const reloadPlanOf = (
  requested: MutantRunOptions['reloadEnvironment'],
  current: EnvironmentState,
  canReload: boolean,
) => ({
  reloadEnvironment: reloadEnvironmentDecision(requested, current, canReload),
  retire: retireDecision(current, canReload),
  nextState: nextEnvironmentState(requested),
})

export const withEnvironmentReload: {
  (retire: Effect.Effect<void>): (inner: PooledTestRunner) => Effect.Effect<PooledTestRunner>
  (inner: PooledTestRunner): (retire: Effect.Effect<void>) => Effect.Effect<PooledTestRunner>
} = dual(
  2,
  (retire: Effect.Effect<void>, inner: PooledTestRunner): Effect.Effect<PooledTestRunner> =>
    Effect.gen(function*() {
      const state = yield* Ref.make<EnvironmentState>('pristine')

      return {
        ...inner,

        dryRun: (options) => {
          const policy: RunPolicy<DryRunResult, PooledTestRunnerError> = (self) =>
            Ref.set(state, 'loaded').pipe(Effect.andThen(self))
          return policy(inner.dryRun(options))
        },

        mutantRun: (options) =>
          Effect.gen(function*() {
            const current = yield* Ref.get(state)
            const canReload = (yield* inner.capabilities).reloadEnvironment
            const plan = reloadPlanOf(options.reloadEnvironment, current, canReload)

            yield* Boolean.match(plan.retire, {
              onTrue: () => retire,
              onFalse: () => Effect.void,
            })
            const policy: RunPolicy<MutantRunResult, PooledTestRunnerError> = (self) =>
              Effect.gen(function*() {
                const result = yield* self
                yield* Ref.set(state, plan.nextState)
                return result
              })

            return yield* policy(inner.mutantRun({ ...options, reloadEnvironment: plan.reloadEnvironment }))
          }),
      }
    }),
)
