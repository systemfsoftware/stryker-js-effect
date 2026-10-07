import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, type Options, type TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
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
  type PreviousReuseRecord,
  type ReuseRefusalReason,
  type ReuseReport,
  ReuseReportSchema,
  type TimeoutEvidence,
} from '../IncrementalDiff.schema.js'
import type { Project } from '../Project.schema.js'
import { reportTestIds, ResolveReportTestIds } from '../report-test-ids.workflow.js'
import { StageError } from '../Run.schema.js'
import type { TestCoverage } from '../test-coverage.schema.js'
import { runInputsDigestOf, VERDICT_SEMANTICS_VERSION } from '../verdict-semantics.js'
import { incrementalReportTextsOf } from './incremental-reuse.js'

const hashOf = (content: string): string => bytesToHex(sha256(utf8ToBytes(content)))

const emptyRefusalCounts = (): Record<ReuseRefusalReason, number> => ({
  semanticsChanged: 0,
  policyChanged: 0,
  runInputsChanged: 0,
  closureChanged: 0,
  flakyDependency: 0,
  timeoutUnreproduced: 0,
  noPriorRecord: 0,
})

const countedRefusal = (
  counts: Record<ReuseRefusalReason, number>,
  refusal: ReuseRefusalReason,
): Record<ReuseRefusalReason, number> => ({
  ...counts,
  [refusal]: Option.getOrElse(Option.fromUndefinedOr(counts[refusal]), () => 0) + 1,
})

const digestField = (digest: string | undefined) =>
  Option.match(Option.fromUndefinedOr(digest), {
    onNone: (): Readonly<Record<string, never>> => ({}),
    onSome: (present) => ({ closureDigest: present }),
  })

const optionalField = <A>(field: string, value: A | undefined) =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: (): Readonly<Record<string, never>> => ({}),
    onSome: (present) => ({ [field]: present }),
  })

const optionalListField = (field: string, value: readonly string[] | undefined) =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: (): Readonly<Record<string, never>> => ({}),
    onSome: (present) => ({ [field]: [...present] }),
  })

const runnerTestIdTableOf = (report: ReuseReport): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Result.getOrThrow(
      reportTestIds(
        ResolveReportTestIds.make(report.testFiles === undefined ? {} : { testFiles: report.testFiles }),
      ),
    ).map((entry) => [entry.positionalId, entry.runnerTestId] as const),
  )

const runnerTestIdsOf = (
  runnerTestIdByPosition: Readonly<Record<string, string>>,
  ids: readonly string[] | undefined,
): readonly string[] | undefined =>
  Option.getOrUndefined(
    Option.map(Option.fromUndefinedOr(ids), (present) =>
      Arr.map(present, (id) => Option.getOrElse(Record.get(runnerTestIdByPosition, id), () => id))),
  )

const recordsOfReport = (report: ReuseReport): readonly PreviousReuseRecord[] => {
  const runnerTestIdByPosition = runnerTestIdTableOf(report)
  return Object.values(report.files).flatMap((file) =>
    file.mutants.map((mutant): PreviousReuseRecord => ({
      mutantId: mutant.id,
      status: mutant.status,
      ...digestField(mutant.closureDigest),
      verdictSemanticsVersion: report.verdictSemanticsVersion,
      mutantSetPolicy: report.mutantSetPolicy,
      runInputsDigest: report.runInputsDigest,
      ...optionalField('timeoutKind', mutant.timeoutKind),
      ...optionalField('reproductions', mutant.reproductions),
      ...optionalField('testsCompleted', mutant.testsCompleted),
      ...optionalListField('coveredBy', runnerTestIdsOf(runnerTestIdByPosition, mutant.coveredBy)),
      ...optionalListField('killedBy', runnerTestIdsOf(runnerTestIdByPosition, mutant.killedBy)),
    }))
  )
}

const reportOfText = (text: string): Option.Option<ReuseReport> =>
  S.decodeOption(S.fromJsonString(ReuseReportSchema))(text)

const previousRecordsOf = Effect.fnUntraced(function*(input: IncrementalReuseInput) {
  const texts = yield* incrementalReportTextsOf(input)
  return texts.flatMap((text) =>
    Option.match(reportOfText(text), {
      onNone: (): readonly PreviousReuseRecord[] => [],
      onSome: recordsOfReport,
    })
  )
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

const digestOfEntries = (entries: readonly string[]): string => hashOf(entries.join('\n'))

const digestTextOf = (digest: string | undefined): string => Option.getOrElse(Option.fromUndefinedOr(digest), () => '')

const currentDigestOf = (digests: Record<string, string>, mutantId: Mutant.MutantId): string =>
  Option.getOrElse(Record.get(digests, mutantId), () => '')

const priorKilledByOf = (
  previousRecords: readonly PreviousReuseRecord[],
  closureDigests: ClosureDigestsResult,
): Record<string, readonly string[]> =>
  previousRecords.reduce<Record<string, readonly string[]>>(
    (accumulated, record) =>
      Boolean.match(
        Boolean.and(
          Boolean.not(closureDigests.failed),
          Boolean.and(
            Option.isSome(Option.fromUndefinedOr(record.killedBy)),
            digestTextOf(record.closureDigest) === currentDigestOf(closureDigests.digests, record.mutantId),
          ),
        ),
        {
          onTrue: () => ({
            ...accumulated,
            [record.mutantId]: [...Option.getOrElse(Option.fromUndefinedOr(record.killedBy), () => [])],
          }),
          onFalse: () => accumulated,
        },
      ),
    {},
  )

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

const closureEntryOf = (
  digestByTestFile: Readonly<Record<string, string>>,
  openByTestFile: Readonly<Record<string, boolean>>,
  projectDigest: string,
  file: string,
): string =>
  Option.match(Option.fromUndefinedOr(digestByTestFile[file]), {
    onNone: () => projectDigest,
    onSome: (digest) => openEntryOf(openByTestFile[file], digest, projectDigest),
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

const entryDigestsOf = (analysis: ImportClosureAnalysis): Record<string, string> => {
  const digestByTestFile = Object.fromEntries(analysis.closures.map((closure) => [closure.testFile, closure.digest]))
  const openByTestFile = Object.fromEntries(analysis.closures.map((closure) => [closure.testFile, closure.open]))
  return Object.fromEntries(
    analysis.closures.map((closure) => [
      closure.testFile,
      closureEntryOf(digestByTestFile, openByTestFile, analysis.projectDigest, closure.testFile),
    ]),
  )
}

const closureEntriesOf = (
  analysis: ImportClosureAnalysis,
  entryByTestFile: Readonly<Record<string, string>>,
): readonly (readonly [string, string])[] =>
  analysis.closures.map((closure) =>
    [
      closure.testFile,
      coveringEntryOf(entryByTestFile, analysis.projectDigest, closure.testFile),
    ] as const
  )

const digestsFromAnalysisOf = (
  input: IncrementalReuseInput,
  analysis: ImportClosureAnalysis,
): Record<string, string> => {
  const entryByTestFile = entryDigestsOf(analysis)
  const closureEntries = closureEntriesOf(analysis, entryByTestFile)
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

type IncrementalReuseRaw = typeof IncrementalDiffCommand.Encoded & {
  readonly mutantsById: Record<string, Mutant.Mutant>
  readonly closureDigestsByMutantId: Record<string, string>
  readonly priorKilledByByMutantId: Record<string, readonly string[]>
}

const mutantsByIdOf = (mutants: ReadonlyArray<Mutant.Mutant>): Record<string, Mutant.Mutant> =>
  Object.fromEntries(mutants.map((mutant) => [mutant.id, mutant] as const))

const readIncrementalReuseCommand = Effect.fn(SpanTaxonomy.Spans.incrementalReuseRead.name)(function*(
  input: IncrementalReuseInput,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const previousRecords = yield* previousRecordsOf(input)
  const closures = yield* closureDigestsOf(input)
  const runInputsDigest = yield* runInputsDigestOf(fs, path, input.basePath, input.options)
  const command: typeof IncrementalDiffCommand.Encoded = {
    _tag: 'IncrementalDiffCommand',
    currentMutants: [...input.currentMutants],
    previousRecords: [...previousRecords],
    closureDigestsByMutantId: closures.digests,
    closureAnalysisFailed: closures.failed,
    verdictSemanticsVersion: VERDICT_SEMANTICS_VERSION,
    mutantSetPolicy: input.options.mutator.mutantSetPolicy,
    runInputsDigest,
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
    closureDigestsByMutantId: closures.digests,
    priorKilledByByMutantId: priorKilledByOf(previousRecords, closures),
  }
})

export interface IncrementalReusePart {
  readonly mutants: readonly Mutant.Mutant[]
  readonly rememberedResults: readonly Mutant.RunMutantResult[]
  readonly refusal: ReuseRefusalReason | undefined
  readonly closureDigestsByMutantId: Record<string, string>
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
    closureDigestsByMutantId: command.closureDigestsByMutantId,
    timeoutEvidenceByMutantId: priorTimeoutEvidenceOf(decision),
    priorKilledByByMutantId: Option.match(Record.get(command.priorKilledByByMutantId, mutant.id), {
      onNone: () => ({}),
      onSome: (killedBy) => ({ [mutant.id]: [...killedBy] }),
    }),
  })
})

const REMEMBERED_REASON = 'Remembered'

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
  statusReason: REMEMBERED_REASON,
  testsCompleted: entry.testsCompleted,
  ...rememberedCoveredBy(entry),
  ...rememberedKilledBy(entry),
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
        closureDigestsByMutantId: command.closureDigestsByMutantId,
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
          closureDigestsByMutantId: command.closureDigestsByMutantId,
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
}

export type RefusalCounts = Record<ReuseRefusalReason, number>

export interface IncrementalReuse {
  readonly mutants: readonly Mutant.Mutant[]
  readonly rememberedResults: readonly Mutant.RunMutantResult[]
  readonly refusalCounts: RefusalCounts
  readonly closureDigestsByMutantId: Record<string, string>
  readonly timeoutEvidenceByMutantId: Record<string, TimeoutEvidence>
  readonly priorKilledByByMutantId: Record<string, readonly string[]>
}

const closureDigestsOfParts = (parts: readonly IncrementalReusePart[]): Record<string, string> =>
  Option.getOrElse(
    Option.map(Arr.head(parts), (part) => part.closureDigestsByMutantId),
    (): Record<string, string> => ({}),
  )

const timeoutEvidenceOfParts = (parts: readonly IncrementalReusePart[]): Record<string, TimeoutEvidence> =>
  parts.reduce<Record<string, TimeoutEvidence>>(
    (accumulated, part) => ({ ...accumulated, ...part.timeoutEvidenceByMutantId }),
    {},
  )

const countRefusalOfPart = (counts: RefusalCounts, part: IncrementalReusePart): RefusalCounts =>
  part.refusal === undefined ? counts : countedRefusal(counts, part.refusal)

const priorKilledByOfParts = (parts: readonly IncrementalReusePart[]): Record<string, readonly string[]> =>
  parts.reduce<Record<string, readonly string[]>>(
    (accumulated, part) => ({ ...accumulated, ...part.priorKilledByByMutantId }),
    {},
  )

export const readIncrementalReuse = (input: IncrementalReuseInput) =>
  Effect.map(incrementalReuseCell.run(input), (parts) => ({
    mutants: parts.flatMap((part) => part.mutants),
    rememberedResults: parts.flatMap((part) => part.rememberedResults),
    refusalCounts: parts.reduce(countRefusalOfPart, emptyRefusalCounts()),
    closureDigestsByMutantId: closureDigestsOfParts(parts),
    timeoutEvidenceByMutantId: timeoutEvidenceOfParts(parts),
    priorKilledByByMutantId: priorKilledByOfParts(parts),
  }))
