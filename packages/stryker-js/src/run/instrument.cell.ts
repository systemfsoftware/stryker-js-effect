import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Scope from 'effect/Scope'

import { InstrumentCommand, planInstrumentation } from '../plan-instrumentation.workflow.js'
import { ProjectFiles } from '../project-files.service.js'
import type { Project } from '../Project.schema.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { makeSandbox } from '../Sandbox.blueprint.js'
import type { SandboxHandle } from '../Sandbox.handle.js'
import { enteringInstrumentPhase, instrumentFiles, offerSkipsIfAny } from './instrument.js'
import { PhaseClock } from './phase-clock.service.js'
import type { PrepareDone } from './prepare.cell.js'
import { RunEnvironment } from './RunEnvironment.service.js'

export interface InstrumentDone extends PrepareDone {
  readonly mutants: readonly Mutant.Mutant[]
  readonly fileContentDigests: Readonly<Record<string, string>>
  readonly sandbox: SandboxHandle
  readonly concurrency: {
    readonly testRunners: number
    readonly checkers: number
  }
}

const sandboxDirectoriesOf = (input: { readonly command: PrepareDone; readonly basePath: string }) =>
  Option.getOrElse(
    Option.map(
      Option.filter(Option.some(input), () => input.command.options.inPlace),
      (inPlace) => ({
        workingDirectory: inPlace.basePath,
        backupDirectory: inPlace.command.temporaryDirectoryPath,
      }),
    ),
    () => ({ workingDirectory: input.command.temporaryDirectoryPath, backupDirectory: '' }),
  )

type InstrumentRaw = typeof InstrumentCommand.Encoded & {
  readonly prev: PrepareDone
  readonly filesToMutate: readonly Instrument.File[]
  readonly fileContentDigests: Readonly<Record<string, string>>
  readonly instrumentResult: Instrument.InstrumentResult
  readonly instrumentedProject: Project
  readonly sandbox: SandboxHandle
  readonly concurrency: { readonly testRunners: number; readonly checkers: number }
}

const writeInstrument = (raw: InstrumentRaw) =>
  enteringInstrumentPhase(
    raw.filesToMutate.length,
    Effect.as(
      offerSkipsIfAny({ skipped: raw.instrumentResult.skipped, claimants: raw.prev.frameworkClaimants }),
      {
        ...raw.prev,
        project: raw.instrumentedProject,
        mutants: raw.instrumentResult.mutants,
        fileContentDigests: raw.fileContentDigests,
        sandbox: raw.sandbox,
        concurrency: {
          testRunners: raw.concurrency.testRunners,
          checkers: raw.concurrency.checkers,
        },
      },
    ),
  )

const readInstrument = Effect.fn(SpanTaxonomy.Spans.instrumentGather.name)(function*(
  command: PrepareDone & {
    readonly concurrency: { readonly testRunners: number; readonly checkers: number }
  },
) {
  yield* Scope.Scope
  const env = yield* RunEnvironment
  const { filesToMutate, fileContentDigests, instrumentResult, instrumentedProject } = yield* instrumentFiles(command)

  const directories = sandboxDirectoriesOf({ command, basePath: env.basePath })
  const sandbox = yield* makeSandbox({
    options: command.options,
    project: instrumentedProject,
    workingDirectory: directories.workingDirectory,
    backupDirectory: directories.backupDirectory,
    basePath: env.basePath,
    formatRegistry: command.formatRegistry,
  }).pipe(
    Effect.mapError((cause) =>
      StageError.make({ stage: 'instrument', reason: 'Sandbox initialization failed', cause })
    ),
  )

  const raw: InstrumentRaw = {
    _tag: 'InstrumentCommand',
    fileCount: filesToMutate.length,
    inPlace: command.options.inPlace,
    pluginCount: command.loadedPlugins.pluginModulePaths.length,
    prev: command,
    filesToMutate,
    fileContentDigests,
    instrumentResult,
    instrumentedProject,
    sandbox,
    concurrency: command.concurrency,
  }
  return raw
})

export const instrumentCell: Cell.Cell<
  PrepareDone & { readonly concurrency: { readonly testRunners: number; readonly checkers: number } },
  InstrumentDone,
  StageError,
  | Scope.Scope
  | PhaseClock
  | RunEnvironment
  | ProjectFiles
  | RunEvents
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner
> = Sandwich.named(SpanTaxonomy.Spans.instrument.name)(readInstrument).decide(planInstrumentation).write({
  InPlaceInstrument: (_decision, raw) => writeInstrument(raw),
  EphemeralInstrument: (_decision, raw) => writeInstrument(raw),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'instrument', reason: issue })),
})
