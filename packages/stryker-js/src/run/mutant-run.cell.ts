import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Pool from 'effect/Pool'
import type * as Scope from 'effect/Scope'

import { interpretMutantRun } from '../interpret-mutant-run.workflow.js'
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

const readMutantRun = Effect.fnUntraced(function*(input: RunOnePlanArgs) {
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
    args: input,
    runner,
    result,
  }
})

export const mutantRunCell: Cell.Cell<
  RunOnePlanArgs,
  Mutant.RunMutantResult,
  StageError | PooledTestRunnerError,
  Scope.Scope
> = Sandwich.named(SpanTaxonomy.Spans.mutantRun.name)(readMutantRun)
  .decide(interpretMutantRun)
  .write({
    MutantRunSettled: (_decision, raw) => settleMutantRun(raw),
    MutantRunPoolInvalidated: (_decision, raw) => recycleAndSettleMutantRun(raw),
    CommandRejected: ({ issue }) =>
      Effect.fail(StageError.make({ stage: 'mutationTest', reason: `mutant run command rejected: ${issue}` })),
  })
