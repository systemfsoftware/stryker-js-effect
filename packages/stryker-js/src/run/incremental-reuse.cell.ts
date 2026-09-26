import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { type Format, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as S from 'effect/Schema'

import {
  incrementalDiff,
  IncrementalDiffCommand,
  type MutantRemembered,
  type MutantToRun,
} from '../incremental-diff.workflow.js'
import type { FormatIdentity } from '../IncrementalDiff.schema.js'
import { PreviousFilesSchema, PreviousTestFilesSchema } from '../IncrementalDiff.schema.js'
import type { IncrementalReport } from '../IncrementalReport.schema.js'
import { RelativeNormalizedFileName } from '../matching.schema.js'
import { identityOf } from '../mutation-reporting.service.js'
import { ProjectFiles } from '../project-files.service.js'
import type { Project } from '../Project.schema.js'
import { StageError } from '../Run.schema.js'
import type { TestCoverage } from '../test-coverage.schema.js'

const relativeFileNameOf = (fileName: string, basePath: string) =>
  RelativeNormalizedFileName.fromAbsolute(fileName, basePath).fileName

const readCurrentRelativeFiles = Effect.fn('stryker.mutation_test.read_relative_files')(function*(
  project: Project,
  basePath: string,
) {
  const projectFiles = yield* ProjectFiles
  const entries = yield* projectFiles.readAllOriginal(MutableHashMap.values(project.files))
  return Object.fromEntries(
    entries.map(([file, content]) => [relativeFileNameOf(file.name, basePath), content] as const),
  )
})

type RememberedMutantResult = typeof MutantRemembered.Encoded

const rememberedCoveredBy = (entry: RememberedMutantResult): { readonly coveredBy?: readonly string[] } =>
  Option.match(Option.fromNullishOr(entry.coveredBy), {
    onNone: (): { readonly coveredBy?: readonly string[] } => ({}),
    onSome: (coveredBy) => ({ coveredBy: [...coveredBy] }),
  })

const rememberedKilledBy = (entry: RememberedMutantResult): { readonly killedBy?: readonly string[] } =>
  Option.match(Option.fromNullishOr(entry.killedBy), {
    onNone: (): { readonly killedBy?: readonly string[] } => ({}),
    onSome: (killedBy) => ({ killedBy: [...killedBy] }),
  })

const rememberedCoverage = (entry: RememberedMutantResult): {
  readonly coveredBy?: readonly string[]
  readonly killedBy?: readonly string[]
} => ({
  ...rememberedCoveredBy(entry),
  ...rememberedKilledBy(entry),
})

const REMEMBERED_REASON = 'Remembered'

const rememberedStatusOf = (entry: RememberedMutantResult) =>
  S.decodeUnknownEffect(Mutant.MutantStatusSchema)(entry.status)

const rememberedResultOf = (
  mutant: Mutant.Mutant,
  entry: RememberedMutantResult,
  reportLocation: Mutant.Location,
  status: Mutant.MutantStatus,
): Mutant.RunMutantResult =>
  Object.assign(
    {},
    mutant,
    {
      location: reportLocation,
      status,
      statusReason: REMEMBERED_REASON,
      testsCompleted: entry.testsCompleted,
    },
    rememberedCoverage(entry),
  )

const mutantsByIdOf = (mutants: ReadonlyArray<Mutant.Mutant>): Record<string, Mutant.Mutant> =>
  Object.fromEntries(mutants.map((mutant) => [mutant.id, mutant] as const))

const rememberedOf = (mutant: Mutant.Mutant, entry: RememberedMutantResult) =>
  Effect.map(
    Effect.all([
      Effect.orDie(S.decodeEffect(Mutant.ReportLocationFromMutant)(mutant.location)),
      rememberedStatusOf(entry).pipe(Effect.orDie),
    ]),
    ([reportLocation, status]) => rememberedResultOf(mutant, entry, reportLocation, status),
  )

const previousFilesOf = (report: IncrementalReport | undefined): S.Schema.Type<typeof PreviousFilesSchema> =>
  Option.getOrElse(
    Option.flatMap(
      Option.fromUndefinedOr(report),
      (present) => S.decodeOption(PreviousFilesSchema)(present.files),
    ),
    (): S.Schema.Type<typeof PreviousFilesSchema> => ({}),
  )

const previousTestFilesOf = (
  report: IncrementalReport | undefined,
): S.Schema.Type<typeof PreviousTestFilesSchema> =>
  Option.getOrElse(
    Option.flatMap(
      Option.flatMap(Option.fromUndefinedOr(report), (present) => Option.fromUndefinedOr(present.testFiles)),
      (testFiles) => S.decodeOption(PreviousTestFilesSchema)(testFiles),
    ),
    (): S.Schema.Type<typeof PreviousTestFilesSchema> => ({}),
  )

type LocatedTestResult = TestRunner.TestResult & { readonly fileName: string }

const hasTestFileName = (result: TestRunner.TestResult): result is LocatedTestResult => result.fileName !== undefined

const relativeFileOfTest = (result: LocatedTestResult, basePath: string) =>
  RelativeNormalizedFileName.fromAbsolute(result.fileName, basePath).fileName

const claimedIdentities = (
  project: Project,
  registry: Format.FormatRegistry,
  basePath: string,
): Record<string, FormatIdentity> =>
  Object.fromEntries(
    [...MutableHashMap.keys(project.filesToMutate)].flatMap((name) =>
      Option.match(identityOf(name, registry), {
        onNone: (): ReadonlyArray<readonly [string, FormatIdentity]> => [],
        onSome: (identity) => [[relativeFileNameOf(name, basePath), identity] as const],
      })
    ),
  )

const testIdsByRelativeFileOf = (testCoverage: TestCoverage, basePath: string) =>
  Object.fromEntries(
    [...MutableHashMap.values(testCoverage.testsById)].filter(hasTestFileName).reduce(
      (accumulator, result) => {
        const file = relativeFileOfTest(result, basePath)
        return MutableHashMap.set(
          accumulator,
          file,
          [...Option.getOrElse(MutableHashMap.get(accumulator, file), (): string[] => []), result.id],
        )
      },
      MutableHashMap.empty<string, string[]>(),
    ),
  )

const coveredFilesOfTests = (
  tests: Iterable<LocatedTestResult>,
  basePath: string,
) => [...new Set([...tests].map((result) => relativeFileOfTest(result, basePath)))]

const coveringTestFilesByMutantIdOf = (testCoverage: TestCoverage, basePath: string) =>
  Object.fromEntries(
    [...testCoverage.testsByMutantId].map(([mutantId, tests]) =>
      [mutantId, coveredFilesOfTests([...tests].filter(hasTestFileName), basePath)] as const
    ),
  )

const relativeFileByMutantIdOf = (mutants: readonly Mutant.Mutant[], basePath: string) =>
  Object.fromEntries(
    mutants.map((mutant) => [mutant.id, relativeFileNameOf(mutant.fileName, basePath)] as const),
  )

const incrementalDiffCommandOf = (
  currentMutants: readonly Mutant.Mutant[],
  testCoverage: TestCoverage,
  incrementalReport: IncrementalReport | undefined,
  currentRelativeFiles: Record<string, string>,
  basePath: string,
  force: boolean,
  identitiesByFile: Record<string, FormatIdentity>,
): typeof IncrementalDiffCommand.Encoded => ({
  _tag: 'IncrementalDiffCommand',
  currentMutants: [...currentMutants],
  relativeFileByMutantId: relativeFileByMutantIdOf(currentMutants, basePath),
  previousFiles: previousFilesOf(incrementalReport),
  previousTestFiles: previousTestFilesOf(incrementalReport),
  currentRelativeFiles,
  testIdsByRelativeFile: testIdsByRelativeFileOf(testCoverage, basePath),
  coveringTestFilesByMutantId: coveringTestFilesByMutantIdOf(testCoverage, basePath),
  identitiesByFile,
  force,
})

type IncrementalReuseRaw = typeof IncrementalDiffCommand.Encoded & {
  readonly mutantsById: Record<string, Mutant.Mutant>
}

const readIncrementalReuseCommand = Effect.fn('stryker.incremental_reuse.read')(function*(
  input: IncrementalReuseInput,
) {
  const currentRelativeFiles = yield* readCurrentRelativeFiles(input.project, input.basePath)
  const command = incrementalDiffCommandOf(
    input.currentMutants,
    input.testCoverage,
    input.project.incrementalReport,
    currentRelativeFiles,
    input.basePath,
    input.force,
    claimedIdentities(input.project, input.formatRegistry, input.basePath),
  )
  return {
    ...command,
    mutantsById: mutantsByIdOf(input.currentMutants),
  }
})

export interface IncrementalReusePart {
  readonly mutants: readonly Mutant.Mutant[]
  readonly rememberedResults: readonly Mutant.RunMutantResult[]
}

const mutantToRunPart = Effect.fnUntraced(function*(
  decision: typeof MutantToRun.Encoded,
): Effect.fn.Return<IncrementalReusePart, never> {
  const mutant = yield* Effect.orDie(S.decodeEffect(Mutant.Mutant)(decision.mutant))
  return yield* Effect.succeed<IncrementalReusePart>({ mutants: [mutant], rememberedResults: [] })
})

const rememberedMutantPart = Effect.fnUntraced(function*(
  decision: typeof MutantRemembered.Encoded,
  command: IncrementalReuseRaw,
): Effect.fn.Return<IncrementalReusePart, never> {
  return yield* Option.match(Record.get(command.mutantsById, decision.mutantId), {
    onNone: () => Effect.succeed<IncrementalReusePart>({ mutants: [], rememberedResults: [] }),
    onSome: (mutant) =>
      Effect.map(
        rememberedOf(mutant, decision),
        (result): IncrementalReusePart => ({ mutants: [], rememberedResults: [result] }),
      ),
  })
})

const incrementalReuseCell = Sandwich.named('stryker.incremental_reuse')(readIncrementalReuseCommand)
  .decide(incrementalDiff)
  .write({
    MutantToRun: (decision) => mutantToRunPart(decision),
    MutantRemembered: (decision, command) => rememberedMutantPart(decision, command),
    CommandRejected: ({ issue }) =>
      Effect.die(StageError.make({ stage: 'mutationTest', reason: `incremental reuse command rejected: ${issue}` })),
  })

export interface IncrementalReuseInput {
  readonly project: Project
  readonly currentMutants: readonly Mutant.Mutant[]
  readonly testCoverage: TestCoverage
  readonly basePath: string
  readonly force: boolean
  readonly formatRegistry: Format.FormatRegistry
}

export interface IncrementalReuse {
  readonly mutants: readonly Mutant.Mutant[]
  readonly rememberedResults: readonly Mutant.RunMutantResult[]
}

export const readIncrementalReuse = (input: IncrementalReuseInput) =>
  Effect.map(incrementalReuseCell.run(input), (parts) => ({
    mutants: parts.flatMap((part) => part.mutants),
    rememberedResults: parts.flatMap((part) => part.rememberedResults),
  }))
