import { Cell } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { absurd } from 'effect/Function'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Stream from 'effect/Stream'

import { type CheckedPlans, type CheckerPoolHandle, checkPlans } from '../Checker/checker-pool.handle.js'
import type { CheckerCrash } from '../Checker/Checker.handle.js'
import { withPhaseSpan } from '../reporter-stream.service.js'
import { requireDryRun } from '../require-dry-run.workflow.js'
import { requestedIdsOf, restrictedToRequestedIds } from '../Rerun/rerun-selection.js'
import type { StageError } from '../Run.schema.js'
import { requireDryRunCommandOf } from './dry-run-choice.js'
import { dryRunCell, type TestBasis } from './dry-run.cell.js'
import { incrementalReportTextsOf } from './incremental-reuse.js'
import type { InstrumentDone } from './instrument.cell.js'
import { acquireCheckers, asMutationTestError, reuseAndPlan, settleMutants } from './mutant-settlement.js'
import type { MutationTestPlan } from './mutation-test-plan.cell.js'
import { partitionPlannable, reportDroppedMutants } from './mutation-test-plan.js'
import { mutationTestCell, type MutationTestDone } from './mutation-test.cell.js'
import { phaseEntered, RunEnvironment } from './RunEnvironment.service.js'
import type { StageServices } from './StageServices.service.js'

const plannableOf = (command: InstrumentDone) =>
  partitionPlannable(restrictedToRequestedIds({ mutants: command.mutants, requested: requestedIdsOf(command.options) }))

const untestedBasisOf = (command: InstrumentDone): TestBasis => ({
  ...command,
  testCoverage: {
    testsByMutantId: MutableHashMap.empty(),
    testsById: MutableHashMap.empty(),
    staticCoverage: undefined,
    hitsByMutantId: MutableHashMap.empty(),
    dryRunCoverage: undefined,
  },
  timeOverhead: Duration.zero,
})

const settledWithoutTests = (
  checkerHandle: Option.Option<CheckerPoolHandle>,
  plan: MutationTestPlan,
): Effect.Effect<Option.Option<CheckedPlans<never>>, StageError | CheckerCrash> =>
  Option.match(Option.filter(checkerHandle, () => plan.earlyResults.length === 0), {
    onNone: () => Effect.succeedNone,
    onSome: (handle) =>
      Effect.map(checkPlans(handle, plan.runPlans), (checked) =>
        Option.as(
          Option.liftPredicate(checked, (candidate: CheckedPlans) => candidate.passedPlans.length === 0),
          { ...checked, passedPlans: [] },
        )),
  })

const testedRun = (command: InstrumentDone): Effect.Effect<MutationTestDone, StageError, StageServices> =>
  Effect.flatMap(dryRunCell.run(command), (done) => mutationTestCell.run(done))

const checkerSettledRun = Effect.fnUntraced(function*(command: InstrumentDone) {
  const basis = untestedBasisOf(command)
  const { dropped, plannable } = plannableOf(command)
  const checkers = yield* acquireCheckers(basis)
  const { reuse, plan } = yield* reuseAndPlan({
    basis,
    checkerHandle: checkers.handle,
    plannableMutants: plannable,
    globalTestInputs: [],
    observedModules: undefined,
  })
  const settled = yield* settledWithoutTests(checkers.handle, plan)
  return yield* Option.match(settled, {
    onNone: () =>
      Effect.gen(function*() {
        yield* Effect.logInfo('A checker accepted a mutant this run; running the initial test run it needs.')
        yield* checkers.releaseInBackground
        return yield* testedRun(command)
      }),
    onSome: (checked) =>
      withPhaseSpan(
        SpanTaxonomy.Spans.mutationTestPhase,
        { mutantCount: basis.mutants.length, skippedMutantCount: dropped.length, testCount: 0 },
        () =>
          Effect.gen(function*() {
            yield* reportDroppedMutants(dropped)
            yield* phaseEntered('mutation-test')
            return yield* settleMutants<never, never>({
              basis,
              checkers,
              reuse,
              plan,
              checkedPlans: Stream.succeed(checked),
              closureDigestsByMutantId: {},
              runPlanOf: () => (runPlan) => absurd(runPlan),
            })
          }),
      ),
  })
})

const enterDryRun = Effect.fnUntraced(function*(command: InstrumentDone) {
  yield* phaseEntered('dry-run')
  const env = yield* RunEnvironment
  const texts = yield* incrementalReportTextsOf({ basePath: env.basePath, options: command.options })
  const decision = Result.getOrElse(
    requireDryRun(requireDryRunCommandOf({ options: command.options, mutants: plannableOf(command).plannable, texts })),
    (never: never) => never,
  )
  return yield* Match.value(decision).pipe(
    Match.tag('DryRunNeeded', () => testedRun(command)),
    Match.tag('DryRunSkippable', () =>
      Effect.andThen(
        Effect.logInfo(
          'Deferring the initial test run: a checker rejected every mutant of this run last time. It runs only if a checker accepts one now.',
        ),
        checkerSettledRun(command).pipe(Effect.mapError(asMutationTestError)),
      )),
    Match.exhaustive,
  )
})

export const deferrableDryRunCell: Cell.Cell<InstrumentDone, MutationTestDone, StageError, StageServices> = Cell
  .andThen(
    Cell.id<InstrumentDone>(),
    (command) => Cell.fromEffect(enterDryRun(command)),
  )
