import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'

import { Run } from '@systemfsoftware/stryker-js-contracts'
import type { IncrementalReportDiscard } from '../admit-incremental-report.workflow.js'
import { InstrumentCommand, planInstrumentation } from '../plan-instrumentation.workflow.js'
import { enteringInstrumentPhase, instrumentFiles, offerSkipsIfAny } from './instrument.js'
import type { PrepareForInstrument } from './prepare.js'

export interface PlanInstrumentDone {
  readonly project: Run.Project
  readonly mutants: readonly Mutant.Mutant[]
  readonly options: Options.StrykerOptions
  readonly incrementalReportDiscard?: IncrementalReportDiscard | undefined
}

type PlanInstrumentRaw = typeof InstrumentCommand.Encoded & {
  readonly prev: PrepareForInstrument
  readonly instrumentedProject: Run.Project
  readonly instrumentResult: Instrument.InstrumentResult
  readonly mutants: readonly Mutant.Mutant[]
}

const readPlanInstrument = Effect.fn(SpanTaxonomy.Spans.instrumentGather.name)(function*(
  command: PrepareForInstrument,
) {
  const { filesToMutate, instrumentResult, instrumentedProject } = yield* instrumentFiles(command)
  return {
    _tag: 'InstrumentCommand' as const,
    fileCount: filesToMutate.length,
    inPlace: command.options.inPlace,
    pluginCount: command.loadedPlugins.pluginModulePaths.length,
    prev: command,
    instrumentedProject,
    instrumentResult,
    mutants: instrumentResult.mutants,
  }
})

const writePlanInstrument = (
  raw: PlanInstrumentRaw,
): Effect.Effect<PlanInstrumentDone, never, Run.PhaseClock | Run.RunEnvironment | Run.RunEvents> =>
  enteringInstrumentPhase(
    raw.fileCount,
    Effect.as(
      offerSkipsIfAny({ skipped: raw.instrumentResult.skipped, claimants: raw.prev.frameworkClaimants }),
      {
        project: raw.instrumentedProject,
        mutants: raw.mutants,
        options: raw.prev.options,
        incrementalReportDiscard: raw.prev.incrementalReportDiscard,
      },
    ),
  )

export const planInstrumentCell: Cell.Cell<
  PrepareForInstrument,
  PlanInstrumentDone,
  Run.StageError,
  Run.PhaseClock | Run.RunEnvironment | Run.ProjectFiles | Run.RunEvents
> = Sandwich.named(SpanTaxonomy.Spans.instrument.name)(readPlanInstrument).decide(planInstrumentation).write({
  InPlaceInstrument: (_decision, raw) => writePlanInstrument(raw),
  EphemeralInstrument: (_decision, raw) => writePlanInstrument(raw),
  CommandRejected: ({ issue }) => Effect.fail(Run.StageError.make({ stage: 'instrument', reason: issue })),
})
