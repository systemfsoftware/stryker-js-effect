import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'

import type { ReadProjectDone } from '../read-project.cell.js'
import { withPhaseSpan } from '../reporter-stream.service.js'
import { Reporter } from '../reporter.service.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import { planPrepare } from './plan-prepare.workflow.js'
import { admitPreparedProject, type PrepareForInstrument, type PrepareRaw, readPrepare } from './prepare.js'
import { RunEnvironment } from './RunEnvironment.service.js'

const writePrepareForInstrument = (
  raw: PrepareRaw,
): Effect.Effect<PrepareForInstrument, StageError, RunEvents> =>
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
      }
    }))

export const prepareForInstrumentCell: Cell.Cell<
  ReadProjectDone,
  PrepareForInstrument,
  StageError,
  Scope.Scope | RunEnvironment | RunEvents | WorkerLauncher | FileSystem.FileSystem | Path.Path | Reporter
> = Sandwich.named(SpanTaxonomy.Spans.prepare.name)(readPrepare)
  .decide(planPrepare)
  .write({
    HumanReporters: (_decision, raw) => writePrepareForInstrument(raw),
    MachineReporters: (_decision, raw) => writePrepareForInstrument(raw),
    CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'prepare', reason: issue })),
  })
