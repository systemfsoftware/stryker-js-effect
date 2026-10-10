import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Format } from '@systemfsoftware/stryker-js-instrumenter'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'

import { Run } from '@systemfsoftware/stryker-js-contracts'
import type { Workers } from '@systemfsoftware/stryker-js-contracts'
import type { Reports } from '@systemfsoftware/stryker-js-contracts'
import type { WorkerHost } from '@systemfsoftware/stryker-js-worker-host'
import type { MutatorSelectionDecoded } from '../decode-mutator-selection.workflow.js'
import { layer as temporaryDirectoryLayer } from '../drivers/temporary-directory.js'
import type { MergedCatalog } from '../plan-mutator-catalogs.workflow.js'
import type { ReadProjectDone } from '../read-project.cell.js'
import {
  attachReporterFactories,
  currentReporterInit,
  type PhaseSpan,
  withPhaseSpan,
} from '../reporter-stream.service.js'
import { reporterInputsOf } from '../reporter-wiring.service.js'
import { planPrepare } from './plan-prepare.workflow.js'
import { admitPreparedProject, type PrepareRaw, readPrepare } from './prepare.js'

export interface PrepareDone {
  readonly project: Run.Project
  readonly loadedPlugins: Workers.LoadedPlugins
  readonly ignorers: readonly Ignorer[]
  readonly mutatorCatalogs: readonly MergedCatalog[]
  readonly mutatorSelection: MutatorSelectionDecoded
  readonly formatRegistry: Format.FormatRegistry
  readonly options: Options.StrykerOptions
  readonly temporaryDirectoryPath: string
  readonly reporterStage: Reports.ReporterStage
  readonly frameworkClaimants: readonly WorkerHost.FrameworkClaimant[]
}

export interface PrepareExecutorArgs {
  cliOptions: Options.PartialStrykerOptions
  targetMutatePatterns: string[] | undefined
}

const applyPrepare = Effect.fn(SpanTaxonomy.Spans.prepareApply.name)(function*(
  span: PhaseSpan,
  reporters: readonly string[],
  raw: PrepareRaw,
): Effect.fn.Return<
  PrepareDone,
  Run.StageError,
  Scope.Scope | Workers.WorkerLauncher | FileSystem.FileSystem | Path.Path
> {
  yield* admitPreparedProject(raw)
  const temporaryDirectoryPath = yield* Effect.map(
    Layer.build(temporaryDirectoryLayer(raw.options)),
    (temporaryDirectory) => Context.get(temporaryDirectory, Run.TemporaryDirectory).path,
  ).pipe(
    Effect.mapError((cause) =>
      Run.StageError.make({ stage: 'prepare', reason: 'Failed to create temporary directory', cause })
    ),
  )
  const reporterInputs = yield* reporterInputsOf(
    reporters,
    raw.reporterChoicesByName,
    raw.loaded,
    raw.env.basePath,
    raw.options,
  )
  const reporterInit = yield* currentReporterInit(span)
  const reporterStage = yield* attachReporterFactories(reporterInputs, raw.options, reporterInit)
  const { now } = raw
  yield* Queue.offer(raw.queue, RunEvent.PhaseEntered.make({ phase: 'prepare', elapsedMs: now - raw.env.runStartedAt }))
  return {
    project: raw.project,
    loadedPlugins: raw.loaded,
    ignorers: raw.ignorers,
    mutatorCatalogs: raw.mutatorCatalogs,
    mutatorSelection: raw.mutatorSelection,
    formatRegistry: raw.formatRegistry,
    options: raw.options,
    temporaryDirectoryPath,
    reporterStage,
    frameworkClaimants: raw.frameworkClaimants,
  }
})

const writePrepare = (
  reporters: readonly string[],
  raw: PrepareRaw,
): Effect.Effect<
  PrepareDone,
  Run.StageError,
  Scope.Scope | Workers.WorkerLauncher | FileSystem.FileSystem | Path.Path
> => withPhaseSpan(SpanTaxonomy.Spans.preparePhase, {}, (span) => applyPrepare(span, reporters, raw))

export const prepareCell: Cell.Cell<
  ReadProjectDone,
  PrepareDone,
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
    HumanReporters: ({ reporters }, raw) => writePrepare(reporters, raw),
    MachineReporters: ({ reporters }, raw) => writePrepare(reporters, raw),
    CommandRejected: ({ issue }) => Effect.fail(Run.StageError.make({ stage: 'prepare', reason: issue })),
  })
