import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { File as InstrumenterFile, InstrumentResult } from '@systemfsoftware/stryker-js-instrumenter'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Array from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'
import { PhaseEntered, RunEvents } from '../run-events.service.js'

import { InstrumentCommand, InstrumentError, planInstrumentation } from '../plan-instrumentation.workflow.js'
import type { Project, ProjectFile } from '../Project.schema.js'
import { ProjectFiles } from '../project-files.service.js'
import { withPhaseSpan } from '../reporter-stream.service.js'
import { StageError } from '../Run.schema.js'
import { makeSandbox } from '../Sandbox.resource.js'
import type { SandboxHandle } from '../Sandbox.handle.js'
import type { PrepareDone } from './prepare.cell.js'
import { RunEnvironment } from './RunEnvironment.service.js'

export interface InstrumentDone extends PrepareDone {
  readonly mutants: readonly Mutant[]
  readonly sandbox: SandboxHandle
  readonly concurrency: {
    readonly testRunners: number
    readonly checkers: number
  }
}

type InstrumentRaw = typeof InstrumentCommand.Encoded & {
  readonly prev: PrepareDone
  readonly filesToMutate: readonly InstrumenterFile[]
  readonly instrumentResult: InstrumentResult
  readonly instrumentedProject: Project
  readonly sandbox: SandboxHandle
  readonly concurrency: { readonly testRunners: number; readonly checkers: number }
}

const writeInstrument = (raw: InstrumentRaw) =>
  withPhaseSpan(
    'instrument',
    { fileCount: raw.filesToMutate.length },
    () =>
      Effect.gen(function*() {
        const env = yield* RunEnvironment
        const now = yield* Clock.currentTimeMillis
        const queue = yield* RunEvents
        yield* Queue.offer(queue, PhaseEntered.make({ phase: 'instrument', elapsedMs: now - env.runStartedAt }))

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

const sandboxDirectoriesOf = (command: PrepareDone, basePath: string) =>
  Boolean.match(command.options.inPlace, {
    onTrue: () => ({ workingDirectory: basePath, backupDirectory: command.temporaryDirectoryPath }),
    onFalse: () => ({ workingDirectory: command.temporaryDirectoryPath, backupDirectory: '' }),
  })

const mergeInstrumentedFile = (project: Project, file: ProjectFile): Project => {
  const files = MutableHashMap.fromIterable(project.files)
  MutableHashMap.set(files, file.name, file)
  const filesToMutate = MutableHashMap.fromIterable(project.filesToMutate)
  Boolean.match(file.mutate !== false, {
    onTrue: () => MutableHashMap.set(filesToMutate, file.name, file),
    onFalse: () => MutableHashMap.remove(filesToMutate, file.name),
  })
  return { ...project, files, filesToMutate }
}

const withInstrumentedFiles = (
  project: Project,
  instrumented: Iterable<{ readonly name: string; readonly content: string }>,
): Project =>
  Array.reduce(
    [...instrumented],
    project,
    (current, { name, content }) =>
      Option.match(MutableHashMap.get(current.files, name), {
        onNone: () => current,
        onSome: (existing) => mergeInstrumentedFile(current, { ...existing, content }),
      }),
  )

export const instrumentCell = Sandwich.named('stryker.instrument')((command: PrepareDone & {
  readonly concurrency: { readonly testRunners: number; readonly checkers: number }
}) =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const env = yield* RunEnvironment

    const files = yield* ProjectFiles
    const filesToMutate = yield* Effect.map(
      files.readAll(MutableHashMap.values(command.project.filesToMutate)),
      (readFiles) => readFiles.map(([file, content]) => ({ content, mutate: file.mutate, name: file.name })),
    ).pipe(
      Effect.mapError((cause) =>
        StageError.make({ stage: 'instrument', reason: 'Failed to read files to mutate', cause })
      ),
    )

    const instrumentResult = yield* instrument(filesToMutate, {
      ignorers: [...command.ignorers],
      excludedMutations: [...command.options.mutator.excludedMutations],
    }, env.basePath).pipe(Effect.mapError((cause) =>
      StageError.make({ stage: 'instrument', reason: 'Instrumenter failed', cause })
    ))

    const instrumentedProject = withInstrumentedFiles(command.project, instrumentResult.files)

    const directories = sandboxDirectoriesOf(command, env.basePath)
    const sandbox = yield* makeSandbox({
      options: command.options,
      project: instrumentedProject,
      workingDirectory: directories.workingDirectory,
      backupDirectory: directories.backupDirectory,
      basePath: env.basePath,
    }).pipe(Effect.mapError((cause) =>
      StageError.make({ stage: 'instrument', reason: 'Sandbox initialization failed', cause })
    ))

    const raw: InstrumentRaw = {
      _tag: 'InstrumentCommand',
      fileCount: filesToMutate.length,
      inPlace: command.options.inPlace,
      pluginCount: command.loadedPlugins.pluginModulePaths.length,
      prev: command,
      filesToMutate,
      instrumentResult,
      instrumentedProject,
      sandbox,
      concurrency,
    }
    return raw
  })
).decide(planInstrumentation).write({
  InPlaceInstrument: (_decision, raw) => writeInstrument(raw),
  EphemeralInstrument: (_decision, raw) => writeInstrument(raw),
  InstrumentError: ({ stage, reason }) =>
    Effect.fail(StageError.make({ stage, reason, cause: InstrumentError.make({ stage, reason }) })),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'instrument', reason: issue })),
})

const projectOf = (seeds: readonly ProjectFile[]): Project => {
  const uniqueByName = [...new Map(seeds.map((seed) => [seed.name, seed])).values()]
  return {
    fileDescriptions: {},
    incrementalReport: undefined,
    testFiles: [],
    files: MutableHashMap.fromIterable(uniqueByName.map((seed) => [seed.name, seed] as const)),
    filesToMutate: MutableHashMap.fromIterable(
      uniqueByName.filter((seed) => seed.mutate !== false).map((seed) => [seed.name, seed] as const),
    ),
  }
}

const updatedContentOf = (updates: Map<string, string>, file: ProjectFile) =>
  Option.getOrElse(Option.fromUndefinedOr(updates.get(file.name)), () => file.content)

const untouchedApartFromContent = (updates: Map<string, string>, file: ProjectFile, after: ProjectFile): boolean =>
  after.mutate === file.mutate && after.originalContent === file.originalContent

const contentApplied = (updates: Map<string, string>, file: ProjectFile, after: ProjectFile): boolean =>
  after.content === updatedContentOf(updates, file)

const filesMatchReference = (
  folded: Project,
  initial: readonly ProjectFile[],
  updates: Map<string, string>,
): boolean =>
  MutableHashMap.size(folded.files) === initial.length &&
  initial.every((file) =>
    Option.match(MutableHashMap.get(folded.files, file.name), {
      onNone: () => false,
      onSome: (after) => contentApplied(updates, file, after) && untouchedApartFromContent(updates, file, after),
    }),
  )

const filesToMutateMatchReference = (folded: Project, mutatable: readonly ProjectFile[]): boolean =>
  MutableHashMap.size(folded.filesToMutate) === mutatable.length &&
  mutatable.every((file) =>
    Option.match(MutableHashMap.get(folded.filesToMutate, file.name), {
      onNone: () => false,
      onSome: (after) =>
        Option.match(MutableHashMap.get(folded.files, file.name), {
          onNone: () => false,
          onSome: (inFiles) => after.content === inFiles.content,
        }),
    }),
  )

const referenceLawHolds = (
  seeds: readonly ProjectFile[],
  instrumented: readonly { readonly name: string; readonly content: string }[],
): boolean => {
  const project = projectOf(seeds)
  const folded = withInstrumentedFiles(project, instrumented)
  const updates = new Map(instrumented.map(({ name, content }) => [name, content]))
  const initial = [...MutableHashMap.values(project.files)]
  const mutatable = initial.filter((file) => file.mutate !== false)
  return filesMatchReference(folded, initial, updates) && filesToMutateMatchReference(folded, mutatable)
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Schema } = await import('effect')

  const ProjectSeedSchema = Schema.Struct({
    name: Schema.String.pipe(Schema.check(Schema.isMaxLength(32))),
    mutate: Schema.Union([
      Schema.Boolean,
      Schema.Array(
        Schema.Struct({
          start: Schema.Struct({ line: Schema.Int, column: Schema.Int }),
          end: Schema.Struct({ line: Schema.Int, column: Schema.Int }),
        }),
      ),
    ]),
    content: Schema.UndefinedOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(64)))),
    originalContent: Schema.UndefinedOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(64)))),
  })
  const ProjectSeedsSchema = Schema.Array(ProjectSeedSchema).pipe(Schema.check(Schema.isMaxLength(64)))
  const InstrumentedBatchSchema = Schema.Array(
    Schema.Struct({
      name: Schema.String.pipe(Schema.check(Schema.isMaxLength(32))),
      content: Schema.String.pipe(Schema.check(Schema.isMaxLength(64))),
    }),
  ).pipe(Schema.check(Schema.isMaxLength(64)))

  it.prop(
    '∀files_P_Instrumented_≡LastContentWins',
    [ProjectSeedsSchema, InstrumentedBatchSchema],
    ([seeds, instrumented]) => referenceLawHolds(seeds, instrumented),
  )
}
