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

import type { MutatorSelectionDecoded } from '../decode-mutator-selection.workflow.js'
import type { MergedCatalog } from '../plan-mutator-catalogs.workflow.js'
import type { LoadedPlugins } from '../Plugins.schema.js'
import type { Project } from '../Project.schema.js'
import type { ReadProjectDone } from '../read-project.cell.js'
import {
  attachReporterFactories,
  currentReporterInit,
  type PhaseSpan,
  type ReporterStage,
  withPhaseSpan,
} from '../reporter-stream.service.js'
import { reporterInputsOf } from '../reporter-wiring.service.js'
import { Reporter } from '../reporter.service.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { TemporaryDirectory } from '../Sandbox.service.js'
import type { VerdictStoreShape } from '../verdict-store/VerdictStore.service.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import type { FrameworkClaimant } from './explain-file-skip.workflow.js'
import { planPrepare } from './plan-prepare.workflow.js'
import { admitPreparedProject, type PrepareRaw, readPrepare } from './prepare.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import { verdictStoreOf } from './verdict-store-layer.js'

export interface PrepareDone {
  readonly project: Project
  readonly loadedPlugins: LoadedPlugins
  readonly ignorers: readonly Ignorer[]
  readonly mutatorCatalogs: readonly MergedCatalog[]
  readonly mutatorSelection: MutatorSelectionDecoded
  readonly formatRegistry: Format.FormatRegistry
  readonly options: Options.StrykerOptions
  readonly temporaryDirectoryPath: string
  readonly reporterStage: ReporterStage
  readonly frameworkClaimants: readonly FrameworkClaimant[]
  readonly verdictStore: VerdictStoreShape
}

export interface PrepareExecutorArgs {
  cliOptions: Options.PartialStrykerOptions
  targetMutatePatterns: string[] | undefined
}

const applyPrepare = Effect.fn(SpanTaxonomy.Spans.prepareApply.name)(function*(
  span: PhaseSpan,
  reporters: readonly string[],
  raw: PrepareRaw,
): Effect.fn.Return<PrepareDone, StageError, Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path> {
  yield* admitPreparedProject(raw)
  const temporaryDirectoryPath = yield* Effect.map(
    Layer.build(TemporaryDirectory.layer(raw.options)),
    (temporaryDirectory) => Context.get(temporaryDirectory, TemporaryDirectory).path,
  ).pipe(
    Effect.mapError((cause) =>
      StageError.make({ stage: 'prepare', reason: 'Failed to create temporary directory', cause })
    ),
  )
  const verdictStore = yield* verdictStoreOf({ options: raw.options.verdictStore, basePath: raw.env.basePath }).pipe(
    Effect.mapError((cause) => StageError.make({ stage: 'prepare', reason: cause.message, cause })),
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
    verdictStore,
  }
})

const writePrepare = (
  reporters: readonly string[],
  raw: PrepareRaw,
): Effect.Effect<PrepareDone, StageError, Scope.Scope | WorkerLauncher | FileSystem.FileSystem | Path.Path> =>
  withPhaseSpan(SpanTaxonomy.Spans.preparePhase, {}, (span) => applyPrepare(span, reporters, raw))

export const prepareCell: Cell.Cell<
  ReadProjectDone,
  PrepareDone,
  StageError,
  Scope.Scope | RunEnvironment | RunEvents | WorkerLauncher | FileSystem.FileSystem | Path.Path | Reporter
> = Sandwich.named(SpanTaxonomy.Spans.prepare.name)(readPrepare)
  .decide(planPrepare)
  .write({
    HumanReporters: ({ reporters }, raw) => writePrepare(reporters, raw),
    MachineReporters: ({ reporters }, raw) => writePrepare(reporters, raw),
    CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'prepare', reason: issue })),
  })
