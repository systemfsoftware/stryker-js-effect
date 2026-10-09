import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'

import type { IncrementalReportDiscard } from '../admit-incremental-report.workflow.js'
import { InstrumentCommand, planInstrumentation } from '../plan-instrumentation.workflow.js'
import type { ProjectFiles } from '../project-files.service.js'
import type { Project } from '../Project.schema.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { enteringInstrumentPhase, instrumentFiles, offerSkipsIfAny } from './instrument.js'
import type { PhaseClock } from './phase-clock.service.js'
import type { PrepareForInstrument } from './prepare.js'
import type { RunEnvironment } from './RunEnvironment.service.js'

export interface PlanInstrumentDone {
  readonly project: Project
  readonly mutants: readonly Mutant.Mutant[]
  readonly fileContentDigests: Readonly<Record<string, string>>
  readonly options: Options.StrykerOptions
  readonly incrementalReportDiscard?: IncrementalReportDiscard | undefined
}

type PlanInstrumentRaw = typeof InstrumentCommand.Encoded & {
  readonly prev: PrepareForInstrument
  readonly instrumentedProject: Project
  readonly instrumentResult: Instrument.InstrumentResult
  readonly mutants: readonly Mutant.Mutant[]
  readonly fileContentDigests: Readonly<Record<string, string>>
}

const readPlanInstrument = Effect.fn(SpanTaxonomy.Spans.instrumentGather.name)(function*(
  command: PrepareForInstrument,
) {
  const { filesToMutate, fileContentDigests, instrumentResult, instrumentedProject } = yield* instrumentFiles(command)
  return {
    _tag: 'InstrumentCommand' as const,
    fileCount: filesToMutate.length,
    inPlace: command.options.inPlace,
    pluginCount: command.loadedPlugins.pluginModulePaths.length,
    prev: command,
    instrumentedProject,
    instrumentResult,
    mutants: instrumentResult.mutants,
    fileContentDigests,
  }
})

const writePlanInstrument = (
  raw: PlanInstrumentRaw,
): Effect.Effect<PlanInstrumentDone, never, PhaseClock | RunEnvironment | RunEvents> =>
  enteringInstrumentPhase(
    raw.fileCount,
    Effect.as(
      offerSkipsIfAny({ skipped: raw.instrumentResult.skipped, claimants: raw.prev.frameworkClaimants }),
      {
        project: raw.instrumentedProject,
        mutants: raw.mutants,
        fileContentDigests: raw.fileContentDigests,
        options: raw.prev.options,
        incrementalReportDiscard: raw.prev.incrementalReportDiscard,
      },
    ),
  )

export const planInstrumentCell: Cell.Cell<
  PrepareForInstrument,
  PlanInstrumentDone,
  StageError,
  PhaseClock | RunEnvironment | ProjectFiles | RunEvents
> = Sandwich.named(SpanTaxonomy.Spans.instrument.name)(readPlanInstrument).decide(planInstrumentation).write({
  InPlaceInstrument: (_decision, raw) => writePlanInstrument(raw),
  EphemeralInstrument: (_decision, raw) => writePlanInstrument(raw),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'instrument', reason: issue })),
})
