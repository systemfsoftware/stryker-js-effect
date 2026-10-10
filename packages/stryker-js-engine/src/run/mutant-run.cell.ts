import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Pool from 'effect/Pool'
import type * as Scope from 'effect/Scope'

import { Run } from '@systemfsoftware/stryker-js-contracts'
import type { Workers } from '@systemfsoftware/stryker-js-contracts'
import { WorkerHost } from '@systemfsoftware/stryker-js-worker-host'
import { interpretMutantRun, NoCoveringTestExecutedReason } from '../interpret-mutant-run.workflow.js'
import { cicdAttributesOf, spanRunStatusOf, testSuiteNameOf } from '../mutant-run-span.js'
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

const executedTestsOf = (result: TestRunner.MutantRunResult): readonly TestRunner.ExecutedTest[] | undefined =>
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
    onSome: (executed) => ({ executedTests: executed.map((test) => test.id) }),
  })

interface MutantRunAttemptArgs extends RunOnePlanArgs {
  readonly attempt: number
}

const CI_PIPELINE_RUN_ID_VARIABLES: ReadonlyArray<string> = ['GITHUB_RUN_ID', 'CI_PIPELINE_ID', 'BUILD_ID']
const CI_PIPELINE_NAME_VARIABLES: ReadonlyArray<string> = ['GITHUB_WORKFLOW', 'CI_PIPELINE_NAME', 'BUILD_NAME']

const configuredOf = (variable: string): Effect.Effect<Option.Option<string>> =>
  Config.String(variable).pipe(
    Effect.option,
    Effect.map(Option.filter((value) => value.length > 0)),
  )

const firstConfiguredOf = (variables: ReadonlyArray<string>): Effect.Effect<Option.Option<string>> =>
  Effect.map(Effect.forEach(variables, configuredOf), Option.firstSomeOf)

const ciPipelineAttributes: Effect.Effect<Readonly<Record<string, string>>> = Effect.map(
  Effect.all([firstConfiguredOf(CI_PIPELINE_RUN_ID_VARIABLES), firstConfiguredOf(CI_PIPELINE_NAME_VARIABLES)]),
  ([runId, name]) => cicdAttributesOf({ runId: Option.getOrUndefined(runId), name: Option.getOrUndefined(name) }),
)

const readMutantRunAttempt = Effect.fnUntraced(function*(input: MutantRunAttemptArgs) {
  const { testRunnerPool, plan } = input
  const runner = yield* Pool.get(testRunnerPool)
  const ciAttributes = yield* ciPipelineAttributes
  const [elapsed, result] = yield* Effect.timed(
    runner.mutantRun(plan.runOptions).pipe(
      Effect.withSpan(SpanTaxonomy.Spans.testRunnerMutantRun.name, {
        attributes: {
          'stryker.mutant.id': plan.mutant.id,
          'stryker.mutant.mutator': plan.mutant.mutatorName,
          'stryker.mutant.file': plan.mutant.fileName,
          'test.suite.name': testSuiteNameOf(plan.mutant),
          ...ciAttributes,
        },
      }),
      Effect.tap((runResult) =>
        Effect.annotateCurrentSpan({
          'stryker.mutant.status': runResult.status,
          'test.suite.run.status': spanRunStatusOf(runResult.status),
        })
      ),
      Effect.catchTags({
        OutOfMemoryError: (error) => invalidateSlot(testRunnerPool, runner, error),
        ChildProcessCrashedError: (error) => invalidateSlot(testRunnerPool, runner, error),
      }),
    ),
  )
  return {
    wallClockTimeout: WorkerHost.invalidatesRunnerPool(result.status, reasonOf(result)),
    coveringTests: coveringTestsOf(plan),
    ...executedTestsFieldOf(result),
    elapsedMs: Duration.toMillis(elapsed),
    attempt: input.attempt,
    args: input,
    runner,
    result,
  }
})

const attemptCell: Cell.Cell<
  MutantRunAttemptArgs,
  Mutant.RunMutantResult,
  Run.StageError | Workers.PooledTestRunnerError,
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
        Effect.fail(Run.StageError.make({ stage: 'mutationTest', reason: `mutant run command rejected: ${issue}` })),
    })
)

export const mutantRunCell: Cell.Cell<
  RunOnePlanArgs,
  Mutant.RunMutantResult,
  Run.StageError | Workers.PooledTestRunnerError,
  Scope.Scope
> = Cell.mapInput(attemptCell, (args: RunOnePlanArgs): MutantRunAttemptArgs => ({ ...args, attempt: 0 }))
