import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Pool from 'effect/Pool'
import type * as Scope from 'effect/Scope'

import { interpretMutantRun, NoCoveringTestExecutedReason } from '../interpret-mutant-run.workflow.js'
import { invalidatesRunnerPool } from '../pooled-test-runner.handle.js'
import { StageError } from '../Run.schema.js'
import type { PooledTestRunnerError } from '../TestRunner.schema.js'
import { recycleAndSettleMutantRun, type RunOnePlanArgs, settleMutantRun } from './mutant-run.js'

const reasonOf = (result: { readonly status: string; readonly reason?: string }): string | undefined =>
  Match.value(result).pipe(
    Match.when({ status: 'timeout' }, (timedOut) => timedOut.reason),
    Match.orElse(() => undefined),
  )

const invalidateSlot = <A, E, I>(
  pool: Pool.Pool<A, I>,
  slot: A,
  error: E,
): Effect.Effect<never, E> => Effect.flatMap(Pool.invalidate(pool, slot), () => Effect.fail(error))

const coveringTestsOf = (plan: Mutant.MutantRunPlan): readonly string[] => [
  ...(plan.runOptions.testFilter ?? []),
]

const executedTestsOf = (result: TestRunner.MutantRunResult): readonly TestRunner.TestId[] | undefined =>
  Match.value(result).pipe(
    Match.when({ status: 'killed' }, (killed) => killed.executedTests),
    Match.when({ status: 'survived' }, (survived) => survived.executedTests),
    Match.orElse(() => undefined),
  )

const executedTestsFieldOf = (
  result: TestRunner.MutantRunResult,
): { readonly executedTests?: readonly TestRunner.TestId[] } =>
  Option.match(Option.fromUndefinedOr(executedTestsOf(result)), {
    onNone: () => ({}),
    onSome: (executed) => ({ executedTests: [...executed] }),
  })

interface MutantRunAttemptArgs extends RunOnePlanArgs {
  readonly attempt: number
}

const readMutantRunAttempt = Effect.fnUntraced(function*(input: MutantRunAttemptArgs) {
  const { testRunnerPool, plan } = input
  const runner = yield* Pool.get(testRunnerPool)
  const result = yield* runner.mutantRun(plan.runOptions).pipe(
    Effect.withSpan(SpanTaxonomy.Spans.testRunnerMutantRun.name, {
      attributes: {
        'stryker.mutant.id': plan.mutant.id,
        'stryker.mutant.mutator': plan.mutant.mutatorName,
        'stryker.mutant.file': plan.mutant.fileName,
      },
    }),
    Effect.tap((runResult) =>
      Effect.annotateCurrentSpan({
        'stryker.mutant.status': runResult.status,
      })
    ),
    Effect.catchTags({
      OutOfMemoryError: (error) => invalidateSlot(testRunnerPool, runner, error),
      ChildProcessCrashedError: (error) => invalidateSlot(testRunnerPool, runner, error),
    }),
  )
  return {
    wallClockTimeout: invalidatesRunnerPool(result.status, reasonOf(result)),
    coveringTests: coveringTestsOf(plan),
    ...executedTestsFieldOf(result),
    attempt: input.attempt,
    args: input,
    runner,
    result,
  }
})

const attemptCell: Cell.Cell<
  MutantRunAttemptArgs,
  Mutant.RunMutantResult,
  StageError | PooledTestRunnerError,
  Scope.Scope
> = Cell.suspend(() =>
  Sandwich.named(SpanTaxonomy.Spans.mutantRun.name)(readMutantRunAttempt)
    .decide(interpretMutantRun)
    .write({
      MutantRunSettled: (_decision, raw) => settleMutantRun(raw),
      MutantRunPoolInvalidated: (_decision, raw) => recycleAndSettleMutantRun(raw),
      MutantRunRetry: (_decision, raw) =>
        Effect.flatMap(
          Pool.invalidate(raw.args.testRunnerPool, raw.runner),
          () => attemptCell.run({ ...raw.args, attempt: raw.attempt + 1 }),
        ),
      MutantRunRetryExhausted: (_decision, raw) =>
        Effect.flatMap(
          Pool.invalidate(raw.args.testRunnerPool, raw.runner),
          () =>
            settleMutantRun({
              ...raw,
              result: { status: 'error', errorMessage: NoCoveringTestExecutedReason.literal },
            }),
        ),
      CommandRejected: ({ issue }) =>
        Effect.fail(StageError.make({ stage: 'mutationTest', reason: `mutant run command rejected: ${issue}` })),
    })
)

export const mutantRunCell: Cell.Cell<
  RunOnePlanArgs,
  Mutant.RunMutantResult,
  StageError | PooledTestRunnerError,
  Scope.Scope
> = Cell.mapInput(attemptCell, (args: RunOnePlanArgs): MutantRunAttemptArgs => ({ ...args, attempt: 0 }))
