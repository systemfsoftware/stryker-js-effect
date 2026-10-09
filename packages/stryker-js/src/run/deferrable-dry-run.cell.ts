import { Cell } from '@systemfsoftware/effect-cell-types'
import * as EffectDuration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Result from 'effect/Result'

import { requireDryRun, RequireDryRunCommand } from '../require-dry-run.workflow.js'
import { requestedIdsOf, restrictedToRequestedIds } from '../Rerun/rerun-selection.js'
import type { StageError } from '../Run.schema.js'
import { dryRunCell, type DryRunDone } from './dry-run.cell.js'
import { incrementalReportTextsOf, priorStatusesOf } from './incremental-reuse.js'
import type { InstrumentDone } from './instrument.cell.js'
import { partitionPlannable } from './mutation-test-plan.js'
import { phaseEntered, RunEnvironment } from './RunEnvironment.service.js'
import type { StageServices } from './StageServices.service.js'

const deferredDryRunOf = (command: InstrumentDone): DryRunDone => ({
  ...command,
  dryRunResult: { status: 'complete', tests: [] },
  testCoverage: {
    testsByMutantId: MutableHashMap.empty(),
    testsById: MutableHashMap.empty(),
    staticCoverage: undefined,
    hitsByMutantId: MutableHashMap.empty(),
    dryRunCoverage: undefined,
  },
  timeOverhead: EffectDuration.zero,
  dryRunDeferred: true,
})

const requireDryRunCommandOf = Effect.fnUntraced(function*(command: InstrumentDone) {
  const env = yield* RunEnvironment
  const texts = yield* incrementalReportTextsOf({ basePath: env.basePath, options: command.options })
  const { plannable } = partitionPlannable(
    restrictedToRequestedIds({ mutants: command.mutants, requested: requestedIdsOf(command.options) }),
  )
  return RequireDryRunCommand.make({
    dryRunOnly: command.options.dryRunOnly,
    ignoreStatic: command.options.ignoreStatic,
    hasCheckers: command.options.checkers.length > 0,
    mutantIds: plannable.map((mutant) => mutant.id),
    priorStatuses: priorStatusesOf(texts),
  })
})

const enterDryRun = Effect.fnUntraced(function*(command: InstrumentDone) {
  yield* phaseEntered('dry-run')
  const decision = Result.getOrElse(requireDryRun(yield* requireDryRunCommandOf(command)), (never: never) => never)
  return yield* Match.value(decision).pipe(
    Match.tag('DryRunNeeded', () => dryRunCell.run(command)),
    Match.tag('DryRunSkippable', () =>
      Effect.as(
        Effect.logInfo(
          'Deferring the initial test run: a checker rejected every mutant of this run last time. It runs only if a checker accepts one now.',
        ),
        deferredDryRunOf(command),
      )),
    Match.exhaustive,
  )
})

export const deferrableDryRunCell: Cell.Cell<InstrumentDone, DryRunDone, StageError, StageServices> = Cell.andThen(
  Cell.id<InstrumentDone>(),
  (command) => Cell.fromEffect(enterDryRun(command)),
)
