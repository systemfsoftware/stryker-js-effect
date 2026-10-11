import { type Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Scope from 'effect/Scope'

import { admitMutationTest, MutationTestError } from '../admit-mutation-test.workflow.js'
import { checkPlansStream as checkPlansWithConfiguredCheckers } from '../Checker/checker-pool.handle.js'
import { MutationReporting } from '../mutation-reporting.service.js'
import { MutationTestCommand } from '../MutationTest.schema.js'
import { withPhaseSpan } from '../reporter-stream.service.js'
import { requestedIdsOf, restrictedToRequestedIds } from '../Rerun/rerun-selection.js'
import { StageError } from '../Run.schema.js'
import { IdGenerator } from '../Worker.service.js'
import type { DryRunDone } from './dry-run.cell.js'
import { mutantRunCell } from './mutant-run.cell.js'
import { reportingInputOf } from './mutant-run.js'
import { acquireCheckers, asMutationTestError, reuseAndPlan, settleMutants } from './mutant-settlement.js'
import {
  configuredTestFilesOf,
  isNoCoveragePlan,
  partitionPlannable,
  reportDroppedMutants,
  sandboxFilesOf,
  toReportedMutant,
} from './mutation-test-plan.js'
import { phaseEntered, RunEnvironment } from './RunEnvironment.service.js'
import type { StageServices } from './StageServices.service.js'
import { scoped as testRunnerPoolScoped } from './test-runner-pool.blueprint.js'

export interface MutationTestDone {
  readonly results: readonly Mutant.RunMutantResult[]
  readonly verdict: Plugin.ExitClass | null
}

type MutationTestRaw = typeof MutationTestCommand.Encoded & {
  readonly prev: DryRunDone
  readonly plannableMutants: readonly Mutant.Mutant[]
  readonly droppedMutants: readonly Mutant.Mutant[]
}

const writeMutationTestNoTests = Effect.fn(SpanTaxonomy.Spans.mutationTestNoTests.name)(function*() {
  const env = yield* RunEnvironment
  const now = yield* Clock.currentTimeMillis
  const elapsed = Duration.millis(now - env.runStartedAt)
  yield* Effect.logInfo(`Done in ${Duration.format(elapsed)}.`)
  yield* phaseEntered('mutation-test')
  yield* phaseEntered('reporting')
  return { results: [], verdict: null }
})

const writeMutationTestDryRunOnly = Effect.fn(SpanTaxonomy.Spans.mutationTestDryRunOnly.name)(function*(
  raw: MutationTestRaw,
) {
  const reporting = yield* MutationReporting
  const env = yield* RunEnvironment
  yield* reporting.publishDryRunCoverage(
    reportingInputOf({ prev: raw.prev, env, results: [], rememberedMutantIds: [] }),
  ).pipe(
    Effect.tapCause((cause) => Effect.logWarning('Failed to publish the dry-run coverage', cause)),
    Effect.ignoreCause,
  )
  yield* phaseEntered('mutation-test')
  yield* Effect.logInfo('The dry-run has been completed successfully. No mutations have been executed.')
  yield* phaseEntered('reporting')
  return { results: [], verdict: null }
})

const testRunnerPoolOf = Effect.fnUntraced(function*(prev: DryRunDone, testRunnerCapacity: number) {
  const idGenerator = yield* IdGenerator
  const testFiles = yield* Effect.map(
    sandboxFilesOf({ sandbox: prev.sandbox, fileNames: configuredTestFilesOf(prev) }),
    (pairs) => pairs.map(([, sandboxFileName]) => sandboxFileName),
  )
  return yield* testRunnerPoolScoped({
    options: prev.options,
    fileDescriptions: prev.project.fileDescriptions,
    sandboxWorkingDirectory: prev.sandbox.workingDirectory,
    idGenerator: idGenerator,
    testFiles: testFiles,
    loadedPlugins: prev.loadedPlugins,
    min: prev.concurrency.testRunners,
    max: testRunnerCapacity,
  })
})

const proceedPipeline = Effect.fnUntraced(function*(raw: MutationTestRaw) {
  const prev = raw.prev
  yield* reportDroppedMutants(raw.droppedMutants)
  yield* phaseEntered('mutation-test')
  const checkers = yield* acquireCheckers(prev)
  const testRunnerPool = yield* testRunnerPoolOf(prev, prev.concurrency.testRunners + prev.concurrency.checkers)
  const reporting = yield* MutationReporting
  const { reuse, plan } = yield* reuseAndPlan({
    basis: prev,
    checkerHandle: checkers.handle,
    plannableMutants: raw.plannableMutants,
    globalTestInputs: prev.dryRunResult.globalTestInputs ?? [],
    observedModules: prev.dryRunResult.testFileModules,
  })
  return yield* settleMutants({
    basis: prev,
    checkers,
    reuse,
    plan,
    checkedPlans: checkPlansWithConfiguredCheckers(Option.getOrUndefined(checkers.handle), plan.runPlans),
    checkReadmitted: (readmitted) =>
      checkPlansWithConfiguredCheckers(Option.getOrUndefined(checkers.handle), readmitted),
    closureDigestsByMutantId: reuse.closureDigestsByMutantId,
    runPlanOf: ({ context, checkpoint, settleChecked }) => (runPlan, checkMs) =>
      Option.match(Option.liftPredicate(runPlan, isNoCoveragePlan), {
        onNone: () => Effect.scoped(mutantRunCell.run({ context, testRunnerPool, checkpoint, plan: runPlan })),
        onSome: (noCoverageRunPlan) =>
          Effect.flatMap(
            reporting.reportNoCoverage(toReportedMutant(noCoverageRunPlan.mutant)),
            (reported) => settleChecked(reported, checkMs),
          ),
      }),
  })
})

const writeMutationTestProceed = (raw: MutationTestRaw): Effect.Effect<MutationTestDone, StageError, StageServices> =>
  proceedPipeline(raw).pipe(Effect.mapError(asMutationTestError))

const writeMutationTestOutcome = ({
  raw,
  outcome,
}: {
  readonly raw: MutationTestRaw
  readonly outcome: Effect.Effect<MutationTestDone, StageError, StageServices>
}): Effect.Effect<MutationTestDone, StageError, StageServices> =>
  withPhaseSpan(
    SpanTaxonomy.Spans.mutationTestPhase,
    {
      mutantCount: raw.prev.mutants.length,
      skippedMutantCount: raw.droppedMutants.length,
      testCount: raw.prev.dryRunResult.tests.length,
    },
    () => outcome,
  )

export const mutationTestCell: Cell.Cell<DryRunDone, MutationTestDone, StageError, StageServices> = Sandwich.named(
  SpanTaxonomy.Spans.mutationTest.name,
)((command: DryRunDone) =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const prev = command
    const { dropped, plannable } = partitionPlannable(
      restrictedToRequestedIds({ mutants: prev.mutants, requested: requestedIdsOf(prev.options) }),
    )
    const raw: MutationTestRaw = {
      _tag: 'MutationTestCommand',
      dryRunOnly: prev.options.dryRunOnly,
      allowEmpty: prev.options.allowEmpty,
      testCount: prev.dryRunResult.tests.length,
      isZero: prev.dryRunResult.tests.length === 0,
      prev,
      plannableMutants: plannable,
      droppedMutants: dropped,
    }
    return raw
  })
).decide(admitMutationTest).write({
  MutationTestDryRunOnly: (_decision, raw) =>
    writeMutationTestOutcome({ raw, outcome: writeMutationTestDryRunOnly(raw) }),
  MutationTestNoTests: (_decision, raw) => writeMutationTestOutcome({ raw, outcome: writeMutationTestNoTests() }),
  MutationTestProceed: (_decision, raw) => writeMutationTestOutcome({ raw, outcome: writeMutationTestProceed(raw) }),
  MutationTestError: ({ stage, reason }) =>
    Effect.fail(StageError.make({ stage, reason, cause: MutationTestError.make({ stage, reason }) })),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'mutationTest', reason: issue })),
})
