import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { File as InstrumenterFile, InstrumentResult } from '@systemfsoftware/stryker-js-instrumenter'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as Scope from 'effect/Scope'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import { PhaseEntered, RunEvents } from '../RunEvents.js'

import { InstrumentCommand, planInstrumentation } from '../plan-instrumentation.workflow.js'
import { FILE_CONCURRENCY, toInstrumenterFile, withInstrumentedFiles } from '../Project.js'
import type { Project } from '../Project.js'
import { withPhaseSpan } from '../ReporterStream.js'
import { StageError } from '../Run.schema.js'
import { makeSandbox } from '../Sandbox.js'
import type { SandboxHandle } from '../Sandbox.js'
import { makeConcurrency } from '../Worker.js'
import type { PrepareDone } from './prepare.cell.js'
import { RunEnvironment } from './RunEnvironment.js'

export interface InstrumentDone extends PrepareDone {
  readonly mutants: readonly Mutant[]
  readonly sandbox: SandboxHandle
  readonly concurrency: {
    readonly testRunners: number
    readonly checkers: number
  }
}

interface InstrumentRaw {
  readonly prev: PrepareDone
  readonly filesToMutate: readonly InstrumenterFile[]
  readonly instrumentResult: InstrumentResult
  readonly instrumentedProject: Project
  readonly sandbox: SandboxHandle
  readonly concurrency: { readonly testRunners: number; readonly checkers: number }
}

export const instrumentCell = Sandwich.read((command: PrepareDone) =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const env = yield* RunEnvironment

    const filesToMutate = yield* Effect.forEach([...MutableHashMap.values(command.project.filesToMutate)], (file) =>
      toInstrumenterFile(file), {
      concurrency: FILE_CONCURRENCY,
    }).pipe(
      Effect.mapError((cause) =>
        StageError.make({ stage: 'instrument', reason: 'Failed to read files to mutate', cause })
      ),
    )

    const instrumentResult = yield* instrument(filesToMutate, {
      ignorers: [...command.ignorers],
      excludedMutations: [...command.options.mutator.excludedMutations],
      optInMutations: [...command.options.mutator.optInMutations],
    }, env.basePath).pipe(Effect.mapError((cause) =>
      StageError.make({ stage: 'instrument', reason: 'Instrumenter failed', cause })
    ))

    const instrumentedProject = withInstrumentedFiles(command.project, instrumentResult.files)

    const basePath = env.basePath
    let workingDirectory = command.temporaryDirectoryPath
    let backupDirectory = ''
    if (command.options.inPlace) {
      workingDirectory = basePath
      backupDirectory = command.temporaryDirectoryPath
    }

    const sandbox = yield* makeSandbox({
      options: command.options,
      project: instrumentedProject,
      workingDirectory,
      backupDirectory,
      basePath,
    }).pipe(Effect.mapError((cause) =>
      StageError.make({ stage: 'instrument', reason: 'Sandbox initialization failed', cause })
    ))

    const concurrency = yield* makeConcurrency(command.options).pipe(
      Effect.mapError((cause) =>
        StageError.make({ stage: 'instrument', reason: 'Failed to compute concurrency', cause })
      ),
    )

    const raw: InstrumentRaw = {
      prev: command,
      filesToMutate,
      instrumentResult,
      instrumentedProject,
      sandbox,
      concurrency,
    }
    return raw
  })
).decode(Sandwich.pure((raw: InstrumentRaw): Result.Result<InstrumentCommand, StageError> =>
  Result.succeed(
    InstrumentCommand.make({
      fileCount: raw.filesToMutate.length,
      inPlace: raw.prev.options.inPlace,
      pluginCount: raw.prev.loadedPlugins.pluginModulePaths.length,
    }),
  )
)).decide(planInstrumentation).encode(Sandwich.pure((outcome) => Result.succeed(outcome))).write((output, raw) =>
  withPhaseSpan(
    'instrument',
    { fileCount: raw.filesToMutate.length },
    () =>
      Effect.gen(function*() {
        const env = yield* RunEnvironment
        const now = yield* Clock.currentTimeMillis
        const queue = yield* RunEvents
        yield* Queue.offer(queue, PhaseEntered.make({ phase: 'instrument', elapsedMs: now - env.runStartedAt }))

        const out = output
        if (Result.isFailure(out)) {
          const err = out.failure
          return yield* StageError.make({ stage: err.stage, reason: err.reason, cause: err })
        }
        return {
          ...raw.prev,
          project: raw.instrumentedProject,
          mutants: raw.instrumentResult.mutants,
          sandbox: raw.sandbox,
          concurrency: {
            testRunners: raw.concurrency.testRunners,
            checkers: raw.concurrency.checkers,
          },
        }
      }),
  )
) satisfies Cell.Cell<
  PrepareDone,
  InstrumentDone,
  StageError,
  | Scope.Scope
  | RunEnvironment
  | RunEvents
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
>
