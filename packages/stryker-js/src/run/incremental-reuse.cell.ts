import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, type Options, type TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Record from 'effect/Record'
import * as S from 'effect/Schema'

import { relativeNormalizedFileName } from '../FileMatcher.js'
import { analyzeImportClosure, type ImportClosureAnalysis } from '../import-closure.cell.js'
import {
  incrementalDiff,
  IncrementalDiffCommand,
  type MutantRemembered,
  type MutantToRun,
} from '../incremental-diff.workflow.js'
import {
  type CurrentVerdict,
  type RefusalCounts,
  RefusalCountsSchema,
  type ReuseRefusalReason,
  ReuseRefusalReasonSchema,
  type TimeoutEvidence,
  type VerdictLookup,
  VerdictLookupSchema,
} from '../IncrementalDiff.schema.js'
import type { Project } from '../Project.schema.js'
import { StageError } from '../Run.schema.js'
import type { TestCoverage } from '../test-coverage.schema.js'
import { engineDigestOf, runInputsDigestOf, sha256HexOf } from '../verdict-semantics.js'
import { readableEntriesOf } from '../verdict-store/verdict-blobs.js'
import type { SharedComponents, VerdictEntry } from '../verdict-store/VerdictEntry.schema.js'
import type { ListedEntry, ListOutcome } from '../verdict-store/VerdictStore.schema.js'
import type { VerdictStoreShape } from '../verdict-store/VerdictStore.service.js'
import { currentKeysOf } from './current-verdict.js'

const LOOKUP_CONCURRENCY = 16

const emptyRefusalCounts: Effect.Effect<RefusalCounts> = S.decodeUnknownEffect(RefusalCountsSchema)(
  Object.fromEntries(ReuseRefusalReasonSchema.literals.map((reason) => [reason, 0] as const)),
).pipe(Effect.orDie)

const countedRefusal = (counts: RefusalCounts, refusal: ReuseRefusalReason): RefusalCounts => ({
  ...counts,
  [refusal]: counts[refusal] + 1,
})

const hasTestFileName = (
  result: TestRunner.TestResult,
): result is TestRunner.TestResult & { readonly fileName: string } => result.fileName !== undefined

const coveringTestFilesOf = (
  testCoverage: TestCoverage,
  mutantId: Mutant.MutantId,
  basePath: string,
): readonly string[] =>
  [...Option.getOrElse(
    MutableHashMap.get(testCoverage.testsByMutantId, mutantId),
    () => MutableHashSet.empty<TestRunner.TestResult>(),
  )]
    .filter(hasTestFileName)
    .map((result) => relativeNormalizedFileName(result.fileName, basePath))

const observedTestFilesOf = (testCoverage: TestCoverage): readonly string[] =>
  [...MutableHashMap.values(testCoverage.testsById)].filter(hasTestFileName).map((result) => result.fileName)

const closureTestFilesOf = (input: IncrementalReuseInput): readonly string[] =>
  Arr.dedupe([...input.project.testFiles, ...observedTestFilesOf(input.testCoverage)])

const digestOfEntries = (entries: readonly string[]): string => sha256HexOf(entries.join('\n'))

const staticCoverageCountOf = (staticCoverage: Record<string, number> | undefined, mutantId: string): number =>
  Option.getOrElse(
    Option.flatMap(Option.fromNullishOr(staticCoverage), (counts) => Record.get(counts, mutantId)),
    () => 0,
  )

const runsWholeSuite = (testCoverage: TestCoverage, mutantId: Mutant.MutantId): boolean =>
  Boolean.or(
    staticCoverageCountOf(testCoverage.staticCoverage, mutantId) > 0,
    testCoverage.staticCoverage === undefined,
  )

const openEntryOf = (open: boolean | undefined, digest: string, projectDigest: string): string =>
  Boolean.match(open === true, {
    onTrue: () => projectDigest,
    onFalse: () => digest,
  })

const coveringEntryOf = (
  entryByTestFile: Readonly<Record<string, string>>,
  projectDigest: string,
  file: string,
): string => Option.getOrElse(Option.fromUndefinedOr(entryByTestFile[file]), () => projectDigest)

const uncoveredDigestOf = (
  testCoverage: TestCoverage,
  mutantId: Mutant.MutantId,
  wholeSuiteDigest: string,
): string =>
  Boolean.match(runsWholeSuite(testCoverage, mutantId), {
    onTrue: () => wholeSuiteDigest,
    onFalse: () => digestOfEntries([]),
  })

const mutantClosureDigestOf = (
  testCoverage: TestCoverage,
  mutantId: Mutant.MutantId,
  basePath: string,
  entryByTestFile: Readonly<Record<string, string>>,
  projectDigest: string,
  wholeSuiteDigest: string,
): string => {
  const covering = [...new Set(coveringTestFilesOf(testCoverage, mutantId, basePath))].sort()
  return Boolean.match(covering.length > 0, {
    onTrue: () =>
      digestOfEntries(covering.map((file) => `${file}\u0000${coveringEntryOf(entryByTestFile, projectDigest, file)}`)),
    onFalse: () => uncoveredDigestOf(testCoverage, mutantId, wholeSuiteDigest),
  })
}

const wholeSuiteDigestOf = (
  closureEntries: readonly (readonly [string, string])[],
): string => digestOfEntries(closureEntries.map(([testFile, digest]) => `${testFile}\u0000${digest}`).sort())

const closureEntriesOf = (
  analysis: ImportClosureAnalysis,
): readonly (readonly [string, string])[] =>
  analysis.closures.map((closure) =>
    [
      closure.testFile,
      openEntryOf(closure.open, closure.digest, analysis.projectDigest),
    ] as const
  )

const digestsFromAnalysisOf = (
  input: IncrementalReuseInput,
  analysis: ImportClosureAnalysis,
): Record<string, string> => {
  const closureEntries = closureEntriesOf(analysis)
  const entryByTestFile = Object.fromEntries(closureEntries)
  const wholeSuiteDigest = Boolean.match(closureEntries.length > 0, {
    onTrue: () => wholeSuiteDigestOf(closureEntries),
    onFalse: () => analysis.projectDigest,
  })
  return Object.fromEntries(
    input.currentMutants.map((mutant) => [
      mutant.id,
      mutantClosureDigestOf(
        input.testCoverage,
        mutant.id,
        input.basePath,
        entryByTestFile,
        analysis.projectDigest,
        wholeSuiteDigest,
      ),
    ]),
  )
}

const closureAnalysisOf = (
  input: IncrementalReuseInput,
): Effect.Effect<Option.Option<ImportClosureAnalysis>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.option(
    analyzeImportClosure({
      rootDir: input.basePath,
      projectFiles: Arr.dedupe([...MutableHashMap.keys(input.project.files), ...input.project.testFiles]),
      testFiles: closureTestFilesOf(input),
      globalInputs: input.globalTestInputs.map((file) => input.originalFileOf(file)),
      ...(input.observedModules === undefined ? {} : { observedModules: input.observedModules }),
    }).pipe(
      Effect.tapCause((cause: Cause.Cause<PlatformError>) =>
        Effect.logWarning(
          `Import closure analysis failed; refusing to reuse prior verdicts: ${Cause.pretty(cause)}`,
        )
      ),
    ),
  )

interface ClosureDigestsResult {
  readonly digests: Record<string, string>
  readonly failed: boolean
}

const closureDigestsOf = (
  input: IncrementalReuseInput,
): Effect.Effect<ClosureDigestsResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.map(closureAnalysisOf(input), (analysis) =>
    Option.match(analysis, {
      onNone: (): ClosureDigestsResult => ({ digests: {}, failed: true }),
      onSome: (present) => ({ digests: digestsFromAnalysisOf(input, present), failed: false }),
    }))

interface RunDigests {
  readonly engineDigest: string
  readonly runInputsDigest: string
  readonly mutantSetPolicy: Options.MutantSetPolicy
  readonly checkerConfigDigest: string | undefined
  readonly closures: ClosureDigestsResult
}

const fileContentDigestOf = (input: IncrementalReuseInput, mutant: Mutant.Mutant): string =>
  Option.getOrThrowWith(
    Record.get(input.fileContentDigests, mutant.fileName),
    () => new Error(`the instrumenter read no original text for ${mutant.fileName}, which holds mutant ${mutant.id}`),
  )

const coveringTestIdsOf = (testCoverage: TestCoverage, mutantId: Mutant.MutantId): readonly string[] =>
  Boolean.match(runsWholeSuite(testCoverage, mutantId), {
    onTrue: () => [...MutableHashMap.keys(testCoverage.testsById)],
    onFalse: () =>
      [...Option.getOrElse(
        MutableHashMap.get(testCoverage.testsByMutantId, mutantId),
        () => MutableHashSet.empty<TestRunner.TestResult>(),
      )].map((result) => result.id),
  })

const closureDigestOf = (closures: ClosureDigestsResult, mutantId: Mutant.MutantId): string | undefined =>
  Option.getOrUndefined(Option.filter(Record.get(closures.digests, mutantId), () => Boolean.not(closures.failed)))

const sharedComponentsOf = (
  mutant: Mutant.Mutant,
  run: RunDigests,
  fileContentDigest: string,
): SharedComponents => ({
  engineDigest: run.engineDigest,
  runInputsDigest: run.runInputsDigest,
  mutantSetPolicy: run.mutantSetPolicy,
  mutantId: mutant.id,
  fileName: mutant.fileName,
  mutatorName: mutant.mutatorName,
  replacementDigest: sha256HexOf(mutant.replacement),
  location: mutant.location,
  fileContentDigest,
})

const testedPartsOf = (input: IncrementalReuseInput, run: RunDigests, mutantId: Mutant.MutantId) =>
  Boolean.match(input.testCoverage.dryRunCoverage !== undefined, {
    onTrue: () => ({
      coveringTestIds: coveringTestIdsOf(input.testCoverage, mutantId),
      closureDigest: closureDigestOf(run.closures, mutantId),
      checkerConfigDigest: run.checkerConfigDigest,
    }),
    onFalse: () => ({}),
  })

const currentVerdictOf =
  (input: IncrementalReuseInput, run: RunDigests) => (mutant: Mutant.Mutant): CurrentVerdict => ({
    shared: sharedComponentsOf(mutant, run, fileContentDigestOf(input, mutant)),
    ...testedPartsOf(input, run, mutant.id),
  })

interface StoreLookup {
  readonly entries: ReadonlyArray<ListedEntry>
  readonly unavailable: boolean
}

const UNAVAILABLE: StoreLookup = { entries: [], unavailable: true }

const NOT_LOOKED_UP: StoreLookup = { entries: [], unavailable: false }

const lookupOfListing = (outcome: ListOutcome): StoreLookup =>
  Match.valueTags(outcome, {
    EntriesListed: ({ entries }): StoreLookup => ({ entries, unavailable: false }),
    StoreUnavailable: (): StoreLookup => UNAVAILABLE,
  })

const namesACheckerEntry = (lookup: StoreLookup): boolean => lookup.entries.some((entry) => entry.kind === 'checker')

const verdictLookupOf = (mutant: Mutant.Mutant, current: CurrentVerdict, lookup: StoreLookup): VerdictLookup => ({
  ...lookup,
  mutant,
  current,
  currentKeys: currentKeysOf(current),
})

const withProgramDigest = (programDigest: string | undefined) => (lookup: VerdictLookup): VerdictLookup =>
  verdictLookupOf(lookup.mutant, { ...lookup.current, programDigest }, lookup)

const programDigestNeeded = (lookups: ReadonlyArray<VerdictLookup>): boolean =>
  lookups.some((lookup) => namesACheckerEntry(lookup))

const withProgramDigests = Effect.fnUntraced(function*(
  lookups: ReadonlyArray<VerdictLookup>,
  programDigestOf: Effect.Effect<string | undefined>,
) {
  const programDigest = yield* Boolean.match(programDigestNeeded(lookups), {
    onTrue: () => programDigestOf,
    onFalse: () => Effect.as(Effect.void, undefined),
  })
  return lookups.map((lookup) =>
    Boolean.match(namesACheckerEntry(lookup), {
      onTrue: () => withProgramDigest(programDigest)(lookup),
      onFalse: () => lookup,
    })
  )
})

const checkerConfigDigestFor = (input: IncrementalReuseInput): Effect.Effect<string | undefined> =>
  Boolean.match(input.testCoverage.dryRunCoverage !== undefined, {
    onTrue: () => input.checkerConfigDigestOf,
    onFalse: () => Effect.as(Effect.void, undefined),
  })

type IncrementalReuseRaw = typeof IncrementalDiffCommand.Encoded & {
  readonly mutantsById: Record<string, Mutant.Mutant>
  readonly currentByMutantId: Record<string, CurrentVerdict>
  readonly priorEntries: ReadonlyArray<VerdictEntry>
}

const mutantsByIdOf = (mutants: ReadonlyArray<Mutant.Mutant>): Record<string, Mutant.Mutant> =>
  Object.fromEntries(mutants.map((mutant) => [mutant.id, mutant] as const))

const readIncrementalReuseCommand = Effect.fn(SpanTaxonomy.Spans.incrementalReuseRead.name)(function*(
  input: IncrementalReuseInput,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const run: RunDigests = {
    engineDigest: yield* engineDigestOf(fs, path),
    runInputsDigest: yield* runInputsDigestOf(fs, path, input.basePath, input.options),
    mutantSetPolicy: input.options.mutator.mutantSetPolicy,
    checkerConfigDigest: yield* checkerConfigDigestFor(input),
    closures: yield* closureDigestsOf(input),
  }
  const currentOf = currentVerdictOf(input, run)
  const observed = yield* Effect.forEach(
    input.currentMutants,
    (mutant) =>
      Effect.map(input.store.list(mutant.id), (listing) => {
        const current = currentOf(mutant)
        const lookup = Boolean.match(input.force, {
          onTrue: (): StoreLookup => NOT_LOOKED_UP,
          onFalse: () => lookupOfListing(listing),
        })
        return { lookup: verdictLookupOf(mutant, current, lookup), listing }
      }),
    { concurrency: LOOKUP_CONCURRENCY },
  )
  const lookups = observed.map(({ lookup }) => lookup)
  const decided = yield* withProgramDigests(lookups, input.programDigestOf)
  const command: typeof IncrementalDiffCommand.Encoded = {
    _tag: 'IncrementalDiffCommand',
    lookups: yield* S.encodeEffect(S.Array(VerdictLookupSchema))(decided).pipe(Effect.orDie),
    closureAnalysisFailed: run.closures.failed,
    force: input.force,
    flakyMutantIds: Option.getOrElse(
      Option.map(Option.fromUndefinedOr(input.testCoverage.dryRunCoverage), (coverage) => [
        ...coverage.flakyMutantIds,
      ]),
      () => [],
    ),
  }
  return {
    ...command,
    mutantsById: mutantsByIdOf(input.currentMutants),
    currentByMutantId: Object.fromEntries(decided.map((lookup) => [lookup.mutant.id, lookup.current] as const)),
    priorEntries: observed.flatMap(({ listing }) => readableEntriesOf(listing)),
  }
})

export interface IncrementalReusePart {
  readonly mutants: readonly Mutant.Mutant[]
  readonly rememberedResults: readonly Mutant.RunMutantResult[]
  readonly refusal: ReuseRefusalReason | undefined
  readonly currentByMutantId: Record<string, CurrentVerdict>
  readonly priorEntries: ReadonlyArray<VerdictEntry>
  readonly timeoutEvidenceByMutantId: Record<string, TimeoutEvidence>
  readonly priorKilledByByMutantId: Record<string, readonly string[]>
}

const priorTimeoutEvidenceOf = (decision: typeof MutantToRun.Encoded): Record<string, TimeoutEvidence> =>
  Option.match(Option.fromNullishOr(decision.priorTimeout), {
    onNone: (): Record<string, TimeoutEvidence> => ({}),
    onSome: (priorTimeout) => ({ [decision.mutant.id]: priorTimeout }),
  })

const rememberedTimeoutEvidenceOf = (decision: typeof MutantRemembered.Encoded): Record<string, TimeoutEvidence> =>
  Boolean.match(decision.status === 'Timeout', {
    onTrue: () =>
      Option.match(Option.fromNullishOr(decision.timeoutKind), {
        onNone: (): Record<string, TimeoutEvidence> => ({}),
        onSome: (timeoutKind) => ({
          [decision.mutantId]: {
            timeoutKind,
            reproductions: Option.getOrElse(Option.fromNullishOr(decision.reproductions), () => 0),
          },
        }),
      }),
    onFalse: (): Record<string, TimeoutEvidence> => ({}),
  })

const mutantToRunPart = Effect.fnUntraced(function*(
  decision: typeof MutantToRun.Encoded,
  command: IncrementalReuseRaw,
): Effect.fn.Return<IncrementalReusePart, never> {
  const mutant = yield* Effect.orDie(S.decodeEffect(Mutant.Mutant)(decision.mutant))
  return yield* Effect.succeed<IncrementalReusePart>({
    mutants: [mutant],
    rememberedResults: [],
    refusal: decision.refusal,
    currentByMutantId: command.currentByMutantId,
    priorEntries: command.priorEntries,
    timeoutEvidenceByMutantId: priorTimeoutEvidenceOf(decision),
    priorKilledByByMutantId: Option.match(Option.fromNullishOr(decision.priorKilledBy), {
      onNone: () => ({}),
      onSome: (killedBy) => ({ [mutant.id]: [...killedBy] }),
    }),
  })
})

const rememberedStatusOf = (entry: typeof MutantRemembered.Encoded) =>
  S.decodeEffect(Mutant.MutantStatusSchema)(entry.status)

const rememberedCoveredBy = (entry: typeof MutantRemembered.Encoded): { readonly coveredBy?: readonly string[] } =>
  Option.match(Option.fromNullishOr(entry.coveredBy), {
    onNone: (): { readonly coveredBy?: readonly string[] } => ({}),
    onSome: (coveredBy) => ({ coveredBy: [...coveredBy] }),
  })

const rememberedKilledBy = (entry: typeof MutantRemembered.Encoded): { readonly killedBy?: readonly string[] } =>
  Option.match(Option.fromNullishOr(entry.killedBy), {
    onNone: (): { readonly killedBy?: readonly string[] } => ({}),
    onSome: (killedBy) => ({ killedBy: [...killedBy] }),
  })

const rememberedResultOf = (
  mutant: Mutant.Mutant,
  entry: typeof MutantRemembered.Encoded,
  status: Mutant.MutantStatus,
): Mutant.RunMutantResult => ({
  ...mutant,
  location: mutant.location,
  status,
  statusReason: entry.statusReason,
  testsCompleted: entry.testsCompleted,
  ...rememberedCoveredBy(entry),
  ...rememberedKilledBy(entry),
  remembered: true,
})

const rememberedMutantPart = Effect.fnUntraced(function*(
  decision: typeof MutantRemembered.Encoded,
  command: IncrementalReuseRaw,
): Effect.fn.Return<IncrementalReusePart, never> {
  return yield* Option.match(Record.get(command.mutantsById, decision.mutantId), {
    onNone: () =>
      Effect.succeed<IncrementalReusePart>({
        mutants: [],
        rememberedResults: [],
        refusal: undefined,
        currentByMutantId: command.currentByMutantId,
        priorEntries: command.priorEntries,
        timeoutEvidenceByMutantId: {},
        priorKilledByByMutantId: {},
      }),
    onSome: (mutant) =>
      Effect.map(
        rememberedStatusOf(decision).pipe(Effect.orDie),
        (status): IncrementalReusePart => ({
          mutants: [],
          rememberedResults: [rememberedResultOf(mutant, decision, status)],
          refusal: undefined,
          currentByMutantId: command.currentByMutantId,
          priorEntries: command.priorEntries,
          timeoutEvidenceByMutantId: rememberedTimeoutEvidenceOf(decision),
          priorKilledByByMutantId: {},
        }),
      ),
  })
})

const incrementalReuseCell = Sandwich.named(SpanTaxonomy.Spans.incrementalReuse.name)(readIncrementalReuseCommand)
  .decide(incrementalDiff)
  .write({
    MutantToRun: (decision, command) => mutantToRunPart(decision, command),
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
  readonly options: Options.StrykerOptions
  readonly globalTestInputs: readonly string[]
  readonly observedModules: Readonly<Record<string, readonly string[]>> | undefined
  readonly originalFileOf: (file: string) => string
  readonly fileContentDigests: Readonly<Record<string, string>>
  readonly store: VerdictStoreShape
  readonly checkerConfigDigestOf: Effect.Effect<string | undefined>
  readonly programDigestOf: Effect.Effect<string | undefined>
}

export interface IncrementalReuse {
  readonly mutants: readonly Mutant.Mutant[]
  readonly rememberedResults: readonly Mutant.RunMutantResult[]
  readonly refusalCounts: RefusalCounts
  readonly timeoutEvidenceByMutantId: Record<string, TimeoutEvidence>
  readonly priorKilledByByMutantId: Record<string, readonly string[]>
  readonly currentByMutantId: Record<string, CurrentVerdict>
  readonly priorEntries: ReadonlyArray<VerdictEntry>
  readonly programDigestOf: Effect.Effect<string | undefined>
}

const currentOfParts = (parts: readonly IncrementalReusePart[]): Record<string, CurrentVerdict> =>
  Option.getOrElse(
    Option.map(Arr.head(parts), (part) => part.currentByMutantId),
    (): Record<string, CurrentVerdict> => ({}),
  )

const timeoutEvidenceOfParts = (parts: readonly IncrementalReusePart[]): Record<string, TimeoutEvidence> =>
  Object.fromEntries(parts.flatMap((part) => Object.entries(part.timeoutEvidenceByMutantId)))

const countRefusalOfPart = (counts: RefusalCounts, part: IncrementalReusePart): RefusalCounts =>
  part.refusal === undefined ? counts : countedRefusal(counts, part.refusal)

const priorKilledByOfParts = (parts: readonly IncrementalReusePart[]): Record<string, readonly string[]> =>
  Object.fromEntries(parts.flatMap((part) => Object.entries(part.priorKilledByByMutantId)))

const priorEntriesOfParts = (parts: readonly IncrementalReusePart[]): ReadonlyArray<VerdictEntry> =>
  Option.getOrElse(
    Option.map(Arr.head(parts), (part) => part.priorEntries),
    (): ReadonlyArray<VerdictEntry> => [],
  )

export const readIncrementalReuse = Effect.fnUntraced(function*(input: IncrementalReuseInput) {
  const programDigestOf = yield* Effect.cached(input.programDigestOf)
  const parts = yield* incrementalReuseCell.run({ ...input, programDigestOf })
  return {
    mutants: parts.flatMap((part) => part.mutants),
    rememberedResults: parts.flatMap((part) => part.rememberedResults),
    refusalCounts: parts.reduce(countRefusalOfPart, yield* emptyRefusalCounts),
    timeoutEvidenceByMutantId: timeoutEvidenceOfParts(parts),
    priorKilledByByMutantId: priorKilledByOfParts(parts),
    currentByMutantId: currentOfParts(parts),
    priorEntries: priorEntriesOfParts(parts),
    programDigestOf,
  } satisfies IncrementalReuse
})
