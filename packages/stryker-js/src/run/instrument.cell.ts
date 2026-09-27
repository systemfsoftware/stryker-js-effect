/// <reference types="vitest/importMeta" />
import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Mutant, type MutatorProvider } from '@systemfsoftware/stryker-js-plugin-interface'
import { Boolean } from 'effect'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { absurd } from 'effect/Function'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as Scope from 'effect/Scope'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import { InstrumentCommand, planInstrumentation } from '../plan-instrumentation.workflow.js'
import type { MergedCatalog } from '../plan-mutator-catalogs.workflow.js'
import type { LoadedMutatorProvider } from '../Plugins.schema.js'
import { ProjectFiles } from '../project-files.service.js'
import type { Project, ProjectFile } from '../Project.schema.js'
import { withPhaseSpan } from '../reporter-stream.service.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { makeSandbox } from '../Sandbox.blueprint.js'
import type { SandboxHandle } from '../Sandbox.handle.js'
import { explainFileSkip, ExplainFileSkipCommand, type FrameworkClaimant } from './explain-file-skip.workflow.js'
import type { PrepareDone } from './prepare.cell.js'
import { phaseEntered, RunEnvironment } from './RunEnvironment.service.js'

export interface InstrumentDone extends PrepareDone {
  readonly mutants: readonly Mutant.Mutant[]
  readonly sandbox: SandboxHandle
  readonly concurrency: {
    readonly testRunners: number
    readonly checkers: number
  }
}

const reportSkippedFiles = Effect.fn(SpanTaxonomy.Spans.instrumentReportSkips.name)(
  function*(input: {
    readonly skipped: readonly Instrument.InstrumentFileSkip[]
    readonly claimants: readonly FrameworkClaimant[]
  }) {
    const files = input.skipped.map((skip) =>
      Result.match(
        explainFileSkip(
          ExplainFileSkipCommand.make({ extension: skip.extension, claimants: [...input.claimants] }),
        ),
        {
          onFailure: absurd<RunEvent.SkippedFileRow>,
          onSuccess: (explained): RunEvent.SkippedFileRow => ({
            file: skip.file,
            extension: skip.extension,
            reason: explained.reason,
          }),
        },
      )
    )
    const queue = yield* RunEvents
    yield* Queue.offer(queue, RunEvent.SkippedReported.make({ files }))
  },
)

const offerSkipsIfAny = Effect.fn(SpanTaxonomy.Spans.instrumentOfferSkips.name)(
  function*(input: {
    readonly skipped: readonly Instrument.InstrumentFileSkip[]
    readonly claimants: readonly FrameworkClaimant[]
  }) {
    yield* Boolean.match(input.skipped.length === 0, {
      onTrue: () => Effect.void,
      onFalse: () => reportSkippedFiles(input),
    })
  },
)

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

const mergeInstrumentedFile = (input: { readonly project: Project; readonly file: ProjectFile }): Project => {
  const files = MutableHashMap.fromIterable(input.project.files)
  MutableHashMap.set(files, input.file.name, input.file)
  const filesToMutate = MutableHashMap.fromIterable(input.project.filesToMutate)
  Boolean.match(input.file.mutate === false, {
    onTrue: () => MutableHashMap.remove(filesToMutate, input.file.name),
    onFalse: () => MutableHashMap.set(filesToMutate, input.file.name, input.file),
  })
  return { ...input.project, files, filesToMutate }
}

type InstrumentRaw = typeof InstrumentCommand.Encoded & {
  readonly prev: PrepareDone
  readonly filesToMutate: readonly Instrument.File[]
  readonly instrumentResult: Instrument.InstrumentResult
  readonly instrumentedProject: Project
  readonly sandbox: SandboxHandle
  readonly concurrency: { readonly testRunners: number; readonly checkers: number }
}

const enteringInstrumentPhase = <A, E, R>(raw: InstrumentRaw, body: Effect.Effect<A, E, R>) =>
  withPhaseSpan(
    SpanTaxonomy.Spans.instrumentPhase,
    { fileCount: raw.filesToMutate.length },
    () => Effect.andThen(phaseEntered('instrument'), body),
  )

const writeInstrument = (raw: InstrumentRaw) =>
  enteringInstrumentPhase(
    raw,
    Effect.as(
      offerSkipsIfAny({ skipped: raw.instrumentResult.skipped, claimants: raw.prev.frameworkClaimants }),
      {
        ...raw.prev,
        project: raw.instrumentedProject,
        mutants: raw.instrumentResult.mutants,
        sandbox: raw.sandbox,
        concurrency: {
          testRunners: raw.concurrency.testRunners,
          checkers: raw.concurrency.checkers,
        },
      },
    ),
  )

const withInstrumentedFiles = (
  project: Project,
  instrumented: Iterable<{ readonly name: string; readonly content: string }>,
): Project =>
  Array.reduce(
    [...instrumented],
    project,
    (current, { name, content }) =>
      Option.getOrElse(
        Option.map(
          MutableHashMap.get(current.files, name),
          (existing) => mergeInstrumentedFile({ project: current, file: { ...existing, content } }),
        ),
        () => current,
      ),
  )

const mutatorImplementationsOf = (
  providers: readonly LoadedMutatorProvider[],
): ReadonlyMap<string, MutatorProvider.Mutator> =>
  new Map([
    ...Object.entries(Mutator.defaultMutators),
    ...Object.entries(Mutator.optInMutators),
    ...providers.flatMap(({ contribution }) =>
      contribution.entries.map((entry) => [entry.name, entry.implementation] as const)
    ),
  ])

const mutatorEntryOf = (
  entry: MergedCatalog['entries'][number],
  implementations: ReadonlyMap<string, MutatorProvider.Mutator>,
): readonly Mutator.MutatorEntry[] =>
  Option.match(Option.fromNullishOr(implementations.get(entry.name)), {
    onNone: (): readonly Mutator.MutatorEntry[] => [],
    onSome: (implementation): readonly Mutator.MutatorEntry[] => [[entry.name, implementation]],
  })

const mutatorRegistryOf = (
  catalogs: readonly MergedCatalog[],
  providers: readonly LoadedMutatorProvider[],
): Mutator.MutatorRegistry => {
  const implementations = mutatorImplementationsOf(providers)
  const entries = catalogs.flatMap((catalog) => catalog.entries)
  const entriesOfTier = (tier: MergedCatalog['entries'][number]['tier']): readonly Mutator.MutatorEntry[] =>
    entries.filter((entry) => entry.tier === tier).flatMap((entry) => mutatorEntryOf(entry, implementations))
  return {
    defaults: Object.fromEntries(entriesOfTier('default')),
    optIn: Object.fromEntries(entriesOfTier('optIn')),
  }
}

const readInstrument = Effect.fn(SpanTaxonomy.Spans.instrumentGather.name)(function*(
  command: PrepareDone & {
    readonly concurrency: { readonly testRunners: number; readonly checkers: number }
  },
) {
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

  const { excludedMutations, optInMutations } = command.mutatorSelection
  const instrumentResult = yield* Instrument.instrument(filesToMutate, {
    ignorers: [...command.ignorers],
    excludedMutations: [...excludedMutations],
    mutators: Mutator.selectMutators(
      mutatorRegistryOf(command.mutatorCatalogs, command.loadedPlugins.mutators),
      optInMutations,
    ),
  }, command.formatRegistry).pipe(
    Effect.mapError((cause) => StageError.make({ stage: 'instrument', reason: 'Instrumenter failed', cause })),
  )

  const instrumentedProject = withInstrumentedFiles(command.project, instrumentResult.files)

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

const untouchedApartFromContent = (file: ProjectFile, after: ProjectFile): boolean =>
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
      onSome: (after) => contentApplied(updates, file, after) && untouchedApartFromContent(file, after),
    })
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
    })
  )

const referenceLawHolds = (
  fold: typeof withInstrumentedFiles,
  seeds: readonly ProjectFile[],
  instrumented: readonly { readonly name: string; readonly content: string }[],
): boolean => {
  const project = projectOf(seeds)
  const folded = fold(project, instrumented)
  const updates = new Map(instrumented.map(({ name, content }) => [name, content]))
  const initial = [...MutableHashMap.values(project.files)]
  const mutatable = initial.filter((file) => file.mutate !== false)
  return filesMatchReference(folded, initial, updates) && filesToMutateMatchReference(folded, mutatable)
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
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
    '∀files_Instrumentation_≡LastContentWins',
    { of: [ProjectSeedsSchema, InstrumentedBatchSchema], subject: withInstrumentedFiles },
    (subject, [seeds, instrumented]) => referenceLawHolds(subject, seeds, instrumented),
  )
}
