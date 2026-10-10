import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Run } from '@systemfsoftware/stryker-js-contracts'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { WorkerHost } from '@systemfsoftware/stryker-js-worker-host'
import { Boolean } from 'effect'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import { absurd, dual } from 'effect/Function'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import { withPhaseSpan } from '../reporter-stream.service.js'
import type { PrepareForInstrument } from './prepare.js'

const reportSkippedFiles = Effect.fn(SpanTaxonomy.Spans.instrumentReportSkips.name)(
  function*(input: {
    readonly skipped: readonly Instrument.InstrumentFileSkip[]
    readonly claimants: readonly WorkerHost.FrameworkClaimant[]
  }) {
    const files = input.skipped.map((skip) =>
      Result.match(
        WorkerHost.explainFileSkip(
          WorkerHost.ExplainFileSkipCommand.make({ extension: skip.extension, claimants: [...input.claimants] }),
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
    const queue = yield* Run.RunEvents
    yield* Queue.offer(queue, RunEvent.SkippedReported.make({ files }))
  },
)

export const offerSkipsIfAny = Effect.fn(SpanTaxonomy.Spans.instrumentOfferSkips.name)(
  function*(input: {
    readonly skipped: readonly Instrument.InstrumentFileSkip[]
    readonly claimants: readonly WorkerHost.FrameworkClaimant[]
  }) {
    yield* Boolean.match(input.skipped.length === 0, {
      onTrue: () => Effect.void,
      onFalse: () => reportSkippedFiles(input),
    })
  },
)

const mergeInstrumentedFile = (
  input: { readonly project: Run.Project; readonly file: Run.ProjectFile },
): Run.Project => {
  const files = MutableHashMap.fromIterable(input.project.files)
  MutableHashMap.set(files, input.file.name, input.file)
  const filesToMutate = MutableHashMap.fromIterable(input.project.filesToMutate)
  Boolean.match(input.file.mutate === false, {
    onTrue: () => MutableHashMap.remove(filesToMutate, input.file.name),
    onFalse: () => MutableHashMap.set(filesToMutate, input.file.name, input.file),
  })
  return { ...input.project, files, filesToMutate }
}

const withInstrumentedFiles = (
  project: Run.Project,
  instrumented: Iterable<{ readonly name: string; readonly content: string }>,
): Run.Project =>
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

export const instrumentFiles = Effect.fnUntraced(function*(
  command: PrepareForInstrument,
): Effect.fn.Return<
  {
    readonly filesToMutate: readonly Instrument.File[]
    readonly instrumentResult: Instrument.InstrumentResult
    readonly instrumentedProject: Run.Project
  },
  Run.StageError,
  Run.ProjectFiles
> {
  const files = yield* Run.ProjectFiles
  const filesToMutate = yield* Effect.map(
    files.readAll(MutableHashMap.values(command.project.filesToMutate)),
    (readFiles) => readFiles.map(([file, content]) => ({ content, mutate: file.mutate, name: file.name })),
  ).pipe(
    Effect.mapError((cause) =>
      Run.StageError.make({ stage: 'instrument', reason: 'Failed to read files to mutate', cause })
    ),
  )

  const { excludedMutations, optInMutations } = command.mutatorSelection
  const instrumentResult = yield* Instrument.instrument(filesToMutate, {
    ignorers: [...command.ignorers],
    excludedMutations: [...excludedMutations],
    mutantSetPolicy: command.options.mutator.mutantSetPolicy,
    mutators: Mutator.selectMutators(
      Mutator.registryOf(
        command.mutatorCatalogs,
        command.loadedPlugins.mutators.map(({ contribution }) => contribution),
      ),
      optInMutations,
    ),
  }, command.formatRegistry).pipe(
    Effect.mapError((cause) => Run.StageError.make({ stage: 'instrument', reason: 'Instrumenter failed', cause })),
  )

  return {
    filesToMutate,
    instrumentResult,
    instrumentedProject: withInstrumentedFiles(command.project, instrumentResult.files),
  }
})

type InstrumentPhaseServices = Run.PhaseClock | Run.RunEnvironment | Run.RunEvents

export const enteringInstrumentPhase: {
  (fileCount: number): <A, E, R>(body: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R | InstrumentPhaseServices>
  <A, E, R>(
    fileCount: number,
    body: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R | InstrumentPhaseServices>
} = dual(
  2,
  <A, E, R>(fileCount: number, body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | InstrumentPhaseServices> =>
    withPhaseSpan(
      SpanTaxonomy.Spans.instrumentPhase,
      { fileCount },
      () => Effect.andThen(Run.phaseEntered('instrument'), body),
    ),
)

const projectOf = (seeds: readonly Run.ProjectFile[]): Run.Project => {
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

const updatedContentOf = (updates: Map<string, string>, file: Run.ProjectFile) =>
  Option.getOrElse(Option.fromUndefinedOr(updates.get(file.name)), () => file.content)

const untouchedApartFromContent = (file: Run.ProjectFile, after: Run.ProjectFile): boolean =>
  after.mutate === file.mutate && after.originalContent === file.originalContent

const contentApplied = (updates: Map<string, string>, file: Run.ProjectFile, after: Run.ProjectFile): boolean =>
  after.content === updatedContentOf(updates, file)

const filesMatchReference = (
  folded: Run.Project,
  initial: readonly Run.ProjectFile[],
  updates: Map<string, string>,
): boolean =>
  MutableHashMap.size(folded.files) === initial.length &&
  initial.every((file) =>
    Option.match(MutableHashMap.get(folded.files, file.name), {
      onNone: () => false,
      onSome: (after) => contentApplied(updates, file, after) && untouchedApartFromContent(file, after),
    })
  )

const filesToMutateMatchReference = (folded: Run.Project, mutatable: readonly Run.ProjectFile[]): boolean =>
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
  seeds: readonly Run.ProjectFile[],
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
