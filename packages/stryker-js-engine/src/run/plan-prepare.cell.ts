import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'

import { Run } from '@systemfsoftware/stryker-js-contracts'
import type { Workers } from '@systemfsoftware/stryker-js-contracts'
import type { Reports } from '@systemfsoftware/stryker-js-contracts'
import type { ReadProjectDone } from '../read-project.cell.js'
import { withPhaseSpan } from '../reporter-stream.service.js'
import { planPrepare } from './plan-prepare.workflow.js'
import { admitPreparedProject, type PrepareForInstrument, type PrepareRaw, readPrepare } from './prepare.js'

const writePrepareForInstrument = (
  raw: PrepareRaw,
): Effect.Effect<PrepareForInstrument, Run.StageError, Run.RunEvents> =>
  withPhaseSpan(SpanTaxonomy.Spans.preparePhase, {}, () =>
    Effect.gen(function*() {
      yield* admitPreparedProject(raw)
      yield* Queue.offer(
        raw.queue,
        RunEvent.PhaseEntered.make({ phase: 'prepare', elapsedMs: raw.now - raw.env.runStartedAt }),
      )
      return {
        project: raw.project,
        loadedPlugins: raw.loaded,
        ignorers: raw.ignorers,
        mutatorCatalogs: raw.mutatorCatalogs,
        mutatorSelection: raw.mutatorSelection,
        formatRegistry: raw.formatRegistry,
        options: raw.options,
        frameworkClaimants: raw.frameworkClaimants,
        incrementalReportDiscard: raw.incrementalReportDiscard,
      }
    }))

export const prepareForInstrumentCell: Cell.Cell<
  ReadProjectDone,
  PrepareForInstrument,
  Run.StageError,
  | Scope.Scope
  | Run.RunEnvironment
  | Run.RunEvents
  | Workers.WorkerLauncher
  | FileSystem.FileSystem
  | Path.Path
  | Reports.Reporter
> = Sandwich.named(SpanTaxonomy.Spans.prepare.name)(readPrepare)
  .decide(planPrepare)
  .write({
    HumanReporters: (_decision, raw) => writePrepareForInstrument(raw),
    MachineReporters: (_decision, raw) => writePrepareForInstrument(raw),
    CommandRejected: ({ issue }) => Effect.fail(Run.StageError.make({ stage: 'prepare', reason: issue })),
  })
