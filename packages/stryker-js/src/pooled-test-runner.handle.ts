/// <reference types="vitest/importMeta" />
import { Handle } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Cause from 'effect/Cause'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import type { PooledTestRunnerError } from './TestRunner.schema.js'
import { OutOfMemoryError } from './Worker.schema.js'

export const TypeId: unique symbol = Symbol.for('~systemfsoftware/stryker-js/PooledTestRunner')
export type TypeId = typeof TypeId

const PooledTestRunner = Handle.make<{
  readonly capabilities: Effect.Effect<TestRunner.TestRunnerCapabilities, PooledTestRunnerError>
  readonly init: Effect.Effect<void, PooledTestRunnerError>
  readonly dryRun: (options: TestRunner.DryRunOptions) => Effect.Effect<TestRunner.DryRunResult, PooledTestRunnerError>
  readonly mutantRun: (
    options: Mutant.MutantRunOptions,
  ) => Effect.Effect<TestRunner.MutantRunResult, PooledTestRunnerError>
}>()(TypeId)

export type PooledTestRunner = Handle.Of<typeof PooledTestRunner>

export const isPooledTestRunner = PooledTestRunner.is

export const make = (runner: {
  readonly capabilities: Effect.Effect<TestRunner.TestRunnerCapabilities, PooledTestRunnerError>
  readonly init: Effect.Effect<void, PooledTestRunnerError>
  readonly dryRun: (options: TestRunner.DryRunOptions) => Effect.Effect<TestRunner.DryRunResult, PooledTestRunnerError>
  readonly mutantRun: (
    options: Mutant.MutantRunOptions,
  ) => Effect.Effect<TestRunner.MutantRunResult, PooledTestRunnerError>
}): PooledTestRunner =>
  PooledTestRunner.make({
    capabilities: runner.capabilities,
    init: runner.init,
    dryRun: runner.dryRun,
    mutantRun: runner.mutantRun,
  })

type RunPolicy<A, E> = (self: Effect.Effect<A, E, never>) => Effect.Effect<A, E, never>

export const withTimeout: {
  (inner: PooledTestRunner): PooledTestRunner
} = (inner) =>
  make({
    ...inner,
    dryRun: (options) =>
      inner.dryRun(options).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(options.timeout),
          orElse: (): Effect.Effect<TestRunner.DryRunResult> =>
            Effect.succeed({ status: 'timeout', reason: TestRunner.WallClockTimeoutReason.literal }),
        }),
      ),
    mutantRun: (options) =>
      inner.mutantRun(options).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(options.timeout),
          orElse: (): Effect.Effect<TestRunner.MutantRunResult> =>
            Effect.succeed({ status: 'timeout', reason: TestRunner.WallClockTimeoutReason.literal }),
        }),
      ),
  })

export const invalidatesRunnerPool: {
  (status: string, reason: string | undefined): boolean
  (reason: string | undefined): (status: string) => boolean
} = dual(
  2,
  (status: string, reason: string | undefined): boolean =>
    status === 'timeout' && reason === TestRunner.WallClockTimeoutReason.literal,
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
  return make({
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
  })
}

export const withMaxReuse: {
  (options: Pick<Options.StrykerOptions, 'maxTestRunnerReuse'>, retire: Effect.Effect<void>): (
    inner: PooledTestRunner,
  ) => Effect.Effect<PooledTestRunner>
  (retire: Effect.Effect<void>): (
    options: Pick<Options.StrykerOptions, 'maxTestRunnerReuse'>,
  ) => (inner: PooledTestRunner) => Effect.Effect<PooledTestRunner>
} = dual(
  2,
  (
    options: Pick<Options.StrykerOptions, 'maxTestRunnerReuse'>,
    retire: Effect.Effect<void>,
  ): (inner: PooledTestRunner) => Effect.Effect<PooledTestRunner> =>
  (inner) =>
    Match.value(options.maxTestRunnerReuse).pipe(
      Match.when((restartAfter) => restartAfter <= 0, () => Effect.succeed(inner)),
      Match.orElse(
        Effect.fn('stryker.testRunner.withMaxReuse')(function*(restartAfter: number) {
          const runs = yield* Ref.make(0)

          return make({
            ...inner,
            mutantRun: (runOptions: Mutant.MutantRunOptions) => {
              const policy: RunPolicy<TestRunner.MutantRunResult, PooledTestRunnerError> = Effect.fn(
                'stryker.testRunner.maxReusePolicy',
              )(function*(self: Effect.Effect<TestRunner.MutantRunResult, PooledTestRunnerError>) {
                const count = yield* Ref.updateAndGet(runs, (n) => n + 1)
                yield* Boolean.match(count > restartAfter, {
                  onTrue: () => Effect.andThen(retire, Ref.set(runs, 1)),
                  onFalse: () => Effect.void,
                })
                return yield* self
              })
              return policy(inner.mutantRun(runOptions))
            },
          })
        }),
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
  requested: Mutant.MutantRunOptions['reloadEnvironment'],
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
  requested: Mutant.MutantRunOptions['reloadEnvironment'],
  current: EnvironmentState,
  canReload: boolean,
) => ({
  reloadEnvironment: reloadEnvironmentDecision(requested, current, canReload),
  retire: retireDecision(current, canReload),
  nextState: nextEnvironmentState(requested),
})

export const withEnvironmentReload: {
  (retire: Effect.Effect<void>): (inner: PooledTestRunner) => Effect.Effect<PooledTestRunner>
  (inner: PooledTestRunner, retire: Effect.Effect<void>): Effect.Effect<PooledTestRunner>
} = dual(
  2,
  Effect.fn('stryker.testRunner.withEnvironmentReload')(function*(
    inner: PooledTestRunner,
    retire: Effect.Effect<void>,
  ) {
    const state = yield* Ref.make<EnvironmentState>('pristine')

    return make({
      ...inner,

      dryRun: (options) => {
        const policy: RunPolicy<TestRunner.DryRunResult, PooledTestRunnerError> = (self) =>
          Ref.set(state, 'loaded').pipe(Effect.andThen(self))
        return policy(inner.dryRun(options))
      },

      mutantRun: Effect.fn('stryker.testRunner.reloadEnvironment')(function*(options: Mutant.MutantRunOptions) {
        const current = yield* Ref.get(state)
        const canReload = (yield* inner.capabilities).reloadEnvironment
        const plan = reloadPlanOf(options.reloadEnvironment, current, canReload)

        yield* Boolean.match(plan.retire, {
          onTrue: () => retire,
          onFalse: () => Effect.void,
        })
        const policy: RunPolicy<TestRunner.MutantRunResult, PooledTestRunnerError> = Effect.fn(
          'stryker.testRunner.applyEnvironmentState',
        )(function*(self: Effect.Effect<TestRunner.MutantRunResult, PooledTestRunnerError>) {
          const result = yield* self
          yield* Ref.set(state, plan.nextState)
          return result
        })

        return yield* policy(inner.mutantRun({ ...options, reloadEnvironment: plan.reloadEnvironment }))
      }),
    })
  }),
)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const answeringWith = (errorMessage: string): PooledTestRunner =>
    make({
      capabilities: Effect.succeed({ reloadEnvironment: true }),
      init: Effect.void,
      dryRun: () => Effect.succeed({ status: 'error', errorMessage }),
      mutantRun: () => Effect.succeed({ status: 'error', errorMessage }),
    })

  const answeredBy = (errorMessage: string) => (result: TestRunner.DryRunResult): boolean =>
    result.status === 'error' && result.errorMessage === errorMessage

  const decoratedDryRunsWrapped = (
    reload: typeof withEnvironmentReload,
    options: TestRunner.DryRunOptions,
    errorMessage: string,
  ) =>
    Effect.gen(function*() {
      const wrapped = answeringWith(errorMessage)
      const curried = yield* reload(Effect.void)(wrapped)
      const dataFirst = yield* reload(wrapped, Effect.void)
      const answers = [yield* curried.dryRun(options), yield* dataFirst.dryRun(options)]
      return answers.every(answeredBy(errorMessage))
    })

  it.effect.prop(
    '∀om_EnvironmentReload_≡WrappedDryRun',
    { of: [TestRunner.DryRunOptionsSchema, S.String], subject: withEnvironmentReload },
    (subject, [options, errorMessage]) => decoratedDryRunsWrapped(subject, options, errorMessage).pipe(Effect.orDie),
  )

  const recordingRunner = (canReload: boolean, log: Ref.Ref<ReadonlyArray<string>>): PooledTestRunner =>
    make({
      capabilities: Effect.succeed({ reloadEnvironment: canReload }),
      init: Effect.void,
      dryRun: () => Effect.succeed({ status: 'error', errorMessage: 'dry run' }),
      mutantRun: (options) =>
        Ref.update(log, (events) => [...events, `run:${options.reloadEnvironment}`]).pipe(
          Effect.as({ status: 'error', errorMessage: 'mutant run' }),
        ),
    })

  const leftStaticMutant = (requests: ReadonlyArray<boolean>, index: number): boolean =>
    index > 0 && requests[index - 1] === true

  const environmentLoaded = (index: number, dryRunFirst: boolean): boolean => index > 0 || dryRunFirst

  const reloadRequired = (requested: boolean, loaded: boolean, staticMutantLeft: boolean): boolean =>
    Boolean.match(requested, { onTrue: () => loaded, onFalse: () => staticMutantLeft })

  const retireRequired = (canReload: boolean, staticMutantLeft: boolean): boolean => !canReload && staticMutantLeft

  const expectedEvents = (requests: ReadonlyArray<boolean>, canReload: boolean, dryRunFirst: boolean) =>
    requests.flatMap((requested, index) => {
      const staticMutantLeft = leftStaticMutant(requests, index)
      const loaded = environmentLoaded(index, dryRunFirst)
      const run = `run:${canReload && reloadRequired(requested, loaded, staticMutantLeft)}`
      return Boolean.match(retireRequired(canReload, staticMutantLeft), {
        onTrue: () => ['retire', run],
        onFalse: () => [run],
      })
    })

  const mutantRunsFollowReloadContract = (
    reload: typeof withEnvironmentReload,
    options: Mutant.MutantRunOptions,
    requests: ReadonlyArray<boolean>,
    canReload: boolean,
    dryRunFirst: boolean,
  ) =>
    Effect.gen(function*() {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const retire = Ref.update(log, (events) => [...events, 'retire'])
      const decorated = yield* reload(recordingRunner(canReload, log), retire)
      yield* Effect.when(
        decorated.dryRun({ timeout: 1000, disableBail: false, coverageAnalysis: 'off' }),
        Effect.succeed(dryRunFirst),
      )
      yield* Effect.forEach(requests, (reloadEnvironment) => decorated.mutantRun({ ...options, reloadEnvironment }), {
        discard: true,
      })
      const events = yield* Ref.get(log)
      return events.join(' ') === expectedEvents(requests, canReload, dryRunFirst).join(' ')
    })

  it.effect.prop(
    '∀om_EnvironmentReload_≡ReloadOrRetire',
    {
      of: [Mutant.MutantRunOptionsSchema, S.Array(S.Boolean), S.Boolean, S.Boolean],
      subject: withEnvironmentReload,
    },
    (subject, [options, requests, canReload, dryRunFirst]) =>
      mutantRunsFollowReloadContract(subject, options, requests, canReload, dryRunFirst).pipe(Effect.orDie),
  )
}
