import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Boolean } from 'effect'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import { absurd, dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'

import { ProjectFiles } from '../project-files.service.js'
import type { Project, ProjectFile } from '../Project.schema.js'
import { withPhaseSpan } from '../reporter-stream.service.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { sha256HexOf } from '../verdict-semantics.js'
import { explainFileSkip, ExplainFileSkipCommand, type FrameworkClaimant } from './explain-file-skip.workflow.js'
import type { PhaseClock } from './phase-clock.service.js'
import type { PrepareForInstrument } from './prepare.js'
import { phaseEntered, type RunEnvironment } from './RunEnvironment.service.js'

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

export const offerSkipsIfAny = Effect.fn(SpanTaxonomy.Spans.instrumentOfferSkips.name)(
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

const mergeInstrumentedFile = (input: { readonly project: Project; readonly file: ProjectFile }): Project => ({
  ...input.project,
  files: new Map([...input.project.files, [input.file.name, input.file]]),
  filesToMutate: Boolean.match(input.file.mutate === false, {
    onTrue: () => new Map([...input.project.filesToMutate].filter(([name]) => name !== input.file.name)),
    onFalse: () => new Map([...input.project.filesToMutate, [input.file.name, input.file]]),
  }),
})

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
          Option.fromUndefinedOr(current.files.get(name)),
          (existing) => mergeInstrumentedFile({ project: current, file: { ...existing, content } }),
        ),
        () => current,
      ),
  )

const originalDigestsByCanonicalName = (files: readonly Instrument.File[]): Readonly<Record<string, string>> =>
  Object.fromEntries(files.map((file) => [file.name.replace(/\\/g, '/'), sha256HexOf(file.content)] as const))

export const instrumentFiles = Effect.fnUntraced(function*(
  command: PrepareForInstrument,
): Effect.fn.Return<
  {
    readonly filesToMutate: readonly Instrument.File[]
    readonly fileContentDigests: Readonly<Record<string, string>>
    readonly instrumentResult: Instrument.InstrumentResult
    readonly instrumentedProject: Project
  },
  StageError,
  ProjectFiles
> {
  const files = yield* ProjectFiles
  const filesToMutate = yield* Effect.map(
    files.readAll(command.project.filesToMutate.values()),
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
    mutantSetPolicy: command.options.mutator.mutantSetPolicy,
    mutators: Mutator.selectMutators(
      Mutator.registryOf(
        command.mutatorCatalogs,
        command.loadedPlugins.mutators.map(({ contribution }) => contribution),
      ),
      optInMutations,
    ),
  }, command.formatRegistry).pipe(
    Effect.mapError((cause) => StageError.make({ stage: 'instrument', reason: 'Instrumenter failed', cause })),
  )

  return {
    filesToMutate,
    fileContentDigests: originalDigestsByCanonicalName(filesToMutate),
    instrumentResult,
    instrumentedProject: withInstrumentedFiles(command.project, instrumentResult.files),
  }
})

type InstrumentPhaseServices = PhaseClock | RunEnvironment | RunEvents

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
      () => Effect.andThen(phaseEntered('instrument'), body),
    ),
)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { Schema } = await import('effect')
  const projectOf = (seeds: readonly ProjectFile[]): Project => {
    const uniqueByName = [...new Map(seeds.map((seed) => [seed.name, seed])).values()]
    return {
      fileDescriptions: {},
      testFiles: [],
      files: new Map(uniqueByName.map((seed) => [seed.name, seed] as const)),
      filesToMutate: new Map(
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
    folded.files.size === initial.length &&
    initial.every((file) =>
      Option.match(Option.fromUndefinedOr(folded.files.get(file.name)), {
        onNone: () => false,
        onSome: (after) => contentApplied(updates, file, after) && untouchedApartFromContent(file, after),
      })
    )

  const filesToMutateMatchReference = (folded: Project, mutatable: readonly ProjectFile[]): boolean =>
    folded.filesToMutate.size === mutatable.length &&
    mutatable.every((file) =>
      Option.match(Option.fromUndefinedOr(folded.filesToMutate.get(file.name)), {
        onNone: () => false,
        onSome: (after) =>
          Option.match(Option.fromUndefinedOr(folded.files.get(file.name)), {
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
    const initial = [...project.files.values()]
    const mutatable = initial.filter((file) => file.mutate !== false)
    return filesMatchReference(folded, initial, updates) && filesToMutateMatchReference(folded, mutatable)
  }

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
