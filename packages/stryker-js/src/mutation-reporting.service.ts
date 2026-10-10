/// <reference types="vitest/importMeta" />
import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { Format } from '@systemfsoftware/stryker-js-instrumenter'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  type Checker,
  type Options,
  type Plugin,
  Report,
  TestRunner,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import type * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Queue from 'effect/Queue'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { writeFileAtomic } from './atomic-write.cell.js'
import { budgetOf } from './budget.js'
import { buildReproducers, BuildReproducersCommand } from './build-reproducers.workflow.js'
import {
  type CheckpointMutantRow,
  checkpointMutants,
  CheckpointMutantsCommand,
  CheckpointSettledMutant,
} from './checkpoint-mutants.workflow.js'
import { classifyExit, ClassifyExitCommand } from './classify-exit.workflow.js'
import type { DryRunCoverage } from './dry-run-coverage.schema.js'
import type { FormatIdentity, TimeoutEvidence, TimeoutKind } from './IncrementalDiff.schema.js'
import { TimeoutEvidenceSchema } from './IncrementalDiff.schema.js'
import { mutantCostsOf } from './mutant-cost-model.js'
import { costTotalMsOf } from './mutant-cost.js'
import type { MutantCost, MutantCostModel } from './MutantCost.schema.js'
import { IncrementalReportObjectSchema, ManifestSchema, ManifestUnreadable } from './mutation-reporting.schema.js'
import type { ResolvedMode } from './output-mode.schema.js'
import { ProjectFiles, type ProjectFilesShape } from './project-files.service.js'
import type { Project, ProjectFile } from './Project.schema.js'
import type { ReporterStage } from './reporter-stream.service.js'
import { closeReporterStage, offerTerminalReport, terminalDrainClass } from './reporter-stream.service.js'
import { metricsResultFromFiles } from './reporting/metrics-from-report.js'
import { ReportFileNames } from './reporting/report-assembly.schema.js'
import { staticVerdictOf } from './reporting/static-verdict.js'
import { buildVerdictEnvelope } from './reporting/verdict-envelope.js'
import { RunEvents } from './run-events.service.js'
import type { MutationTestDone } from './run/mutation-test.cell.js'
import { PhaseClock, type PhaseClockShape } from './run/phase-clock.service.js'
import { REPRODUCERS_FILE } from './stryker-outputs.js'
import { StrykerPackage } from './stryker-package.schema.js'
import type { TestCoverage } from './test-coverage.schema.js'
import { engineDigestOf, INCREMENTAL_CACHE_VERSION, runInputsDigestOf } from './verdict-semantics.js'

export const identityOf = dual<
  (
    fileName: string,
  ) => (registry: Format.FormatRegistry) => Option.Option<FormatIdentity>,
  (fileName: string, registry: Format.FormatRegistry) => Option.Option<FormatIdentity>
>(
  2,
  (fileName: string, registry: Format.FormatRegistry): Option.Option<FormatIdentity> =>
    Option.map(registry.entryForExtension(Format.extensionOf(fileName)), (entry) => ({
      formatId: entry.claim.formatId,
      ownerModule: entry.owner,
      ownerVersion: entry.ownerVersion,
    })),
)

const STRYKER_FRAMEWORK: Readonly<Pick<Report.FrameworkInformation, 'branding' | 'name' | 'version'>> = Object
  .freeze({
    branding: {
      homepageUrl: 'https://stryker-mutator.io',
      imageUrl: 'https://stryker-mutator.io/assets/images/stryker-80x80.png',
    },
    name: 'StrykerJS',
    version: StrykerPackage.version,
  })

const MANIFEST_SPECIFIERS = [
  '@systemfsoftware/stryker-js-vitest-runner',
  '@systemfsoftware/stryker-js-typescript-checker',
  '@systemfsoftware/stryker-ignorer-effect-schema-declarations',
  'vitest',
  'karma',
  'karma-chai',
  'karma-chrome-launcher',
  'karma-jasmine',
  'karma-mocha',
  'mocha',
  'jasmine',
  'jasmine-core',
  'jest',
  'react-scripts',
  'typescript',
  '@angular/cli',
  'webpack',
  'webpack-cli',
  'ts-jest',
] as const

const MANIFEST_CONCURRENCY = 24

export interface MutationReportingInput {
  readonly results: readonly Mutant.RunMutantResult[]
  readonly options: Options.StrykerOptions
  readonly project: Project
  readonly testCoverage: TestCoverage
  readonly runId: string
  readonly resolvedMode: ResolvedMode
  readonly basePath: string
  readonly reporterStage: ReporterStage
  readonly formatRegistry: Format.FormatRegistry
  readonly timeOverheadMs: number
  readonly closureDigestsByMutantId?: Readonly<Record<string, string>>
  readonly timeoutEvidenceByMutantId?: Readonly<Record<string, TimeoutEvidence>>
  readonly rememberedMutantIds: ReadonlyArray<string>
  readonly programDigest?: string
  readonly concurrency: number
  readonly runStartedAt: number
}

export interface MutationReportingService {
  readonly reportCheckFailure: (
    mutant: Mutant.MutantTestCoverage,
    result: Checker.FailedCheckResult,
  ) => Effect.Effect<Mutant.RunMutantResult>
  readonly reportIgnored: (
    mutant: Mutant.MutantTestCoverage,
    result: Checker.IgnoredCheckResult,
  ) => Effect.Effect<Mutant.RunMutantResult>
  readonly reportNoCoverage: (mutant: Mutant.MutantTestCoverage) => Effect.Effect<Mutant.RunMutantResult>
  readonly reportMutantRunResult: (
    mutant: Mutant.MutantTestCoverage,
    result: TestRunner.MutantRunResult,
  ) => Effect.Effect<Mutant.RunMutantResult>
  readonly reportAll: (input: MutationReportingInput) => Effect.Effect<MutationTestDone, PlatformError>
  readonly checkpoint: (
    input: MutationReportingInput,
    plannedMutants: readonly Mutant.Mutant[],
  ) => Effect.Effect<void, PlatformError>
  readonly publishDryRunCoverage: (input: MutationReportingInput) => Effect.Effect<void, PlatformError>
}

export class MutationReporting extends Context.Service<MutationReporting, MutationReportingService>()(
  '@systemfsoftware/stryker-js/mutation-reporting.service/MutationReporting',
) {
  static readonly layer: Layer.Layer<
    MutationReporting,
    never,
    FileSystem.FileSystem | Path.Path | RunEvents | ProjectFiles | PhaseClock
  > = Layer.effect(
    MutationReporting,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const events = yield* RunEvents
      const projectFiles: ProjectFilesShape = yield* ProjectFiles
      const phaseClock = yield* PhaseClock
      const deps: MutationReportingDeps = { fs, path: pathService, events, projectFiles, phaseClock }
      return MutationReporting.of({
        reportCheckFailure: (mutant, result) => reportCheckFailure(mutant, result),
        reportIgnored: (mutant, result) => reportIgnored(mutant, result),
        reportNoCoverage: (mutant) => reportNoCoverage(mutant),
        reportMutantRunResult: (mutant, result) => mapRunResult(mutant, result),
        reportAll: (input) => reportAll(deps, input),
        checkpoint: (input, plannedMutants) => checkpoint(deps, input, plannedMutants),
        publishDryRunCoverage: (input) => publishDryRunCoverage(deps, input),
      })
    }),
  )
}

interface MutationReportingDeps {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly events: Queue.Queue<RunEvent.RunEvent, Cause.Done>
  readonly projectFiles: ProjectFilesShape
  readonly phaseClock: PhaseClockShape
}

interface MutantOutcome {
  readonly killedBy?: readonly string[] | undefined
  readonly statusReason?: string | undefined
  readonly testsCompleted?: number | undefined
}

const reportMutant = (
  mutant: Mutant.MutantTestCoverage,
  status: Mutant.RunMutantResult['status'],
  outcome: MutantOutcome = {},
) =>
  Effect.succeed(
    ({
      _tag: 'Mutant',
      id: mutant.id,
      fileName: mutant.fileName,
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: mutant.location,
      status,
      coveredBy: mutant.coveredBy,
      static: mutant.static,
      testsCompleted: mutant.testsCompleted,
      description: mutant.description,
      ...outcome,
    }) satisfies Mutant.RunMutantResult,
  )

const reportMutantStatus = (
  mutant: Mutant.MutantTestCoverage,
  status: Mutant.RunMutantResult['status'],
  statusReason?: string,
) => reportMutant(mutant, status, { statusReason: statusReason ?? mutant.statusReason })

const reportCheckFailure = (
  mutant: Mutant.MutantTestCoverage,
  result: Checker.FailedCheckResult,
) => reportMutantStatus(mutant, 'CompileError', result.reason)

const reportIgnored = (
  mutant: Mutant.MutantTestCoverage,
  result: Checker.IgnoredCheckResult,
) => reportMutantStatus(mutant, 'Ignored', result.reason)

const reportNoCoverage = (mutant: Mutant.MutantTestCoverage) => reportMutantStatus(mutant, 'NoCoverage')

const reasonedOutcomeOf = (reason: string | undefined) =>
  Option.match(Option.fromNullishOr(reason), {
    onNone: () => ({}),
    onSome: (present) => ({ statusReason: present }),
  })

const mapRunResult = (mutant: Mutant.MutantTestCoverage, result: TestRunner.MutantRunResult) =>
  Match.value(result).pipe(
    Match.discriminator('status')(
      'error',
      (errored) => reportMutant(mutant, 'RuntimeError', { statusReason: errored.errorMessage }),
    ),
    Match.discriminator('status')('killed', (killed) =>
      reportMutant(mutant, 'Killed', {
        testsCompleted: killed.nrOfTests,
        killedBy: [...killed.killedBy],
        statusReason: killed.failureMessage,
      })),
    Match.discriminator('status')(
      'timeout',
      (timedOut) => reportMutant(mutant, 'Timeout', reasonedOutcomeOf(timedOut.reason)),
    ),
    Match.discriminator('status')(
      'survived',
      (survived) => reportMutant(mutant, 'Survived', { testsCompleted: survived.nrOfTests }),
    ),
    Match.exhaustive,
  )

const uniqueNames = (names: readonly (string | undefined)[]): readonly string[] =>
  Arr.dedupe(Arr.filter(names, (name): name is string => name !== undefined))

const partitionByFile = (files: Project['files'], fileNames: readonly string[]) => {
  const [present, missing] = Arr.separate(
    Arr.map(fileNames, (fileName) =>
      Option.match(MutableHashMap.get(files, fileName), {
        onNone: () => Result.fail(fileName),
        onSome: (file) => Result.succeed(file),
      })),
  )
  return { missing, present }
}

const originalSourcesOf = (originals: readonly (readonly [ProjectFile, string])[]) =>
  HashMap.fromIterable(Arr.map(originals, ([file, content]) => [file.name, content] as const))

const UNCLAIMED_LANGUAGE = 'javascript'

const determineLanguage = (fileName: string, registry: Format.FormatRegistry): string =>
  Option.match(registry.entryForExtension(Format.extensionOf(fileName)), {
    onNone: () => UNCLAIMED_LANGUAGE,
    onSome: (entry) => entry.claim.language,
  })

type FileResultWithIdentity = Report.FileResult & { readonly formatIdentity?: FormatIdentity }

const withClosureDigest = (mutant: Report.MutantResult, digest: string | undefined): Report.MutantResult =>
  digest === undefined ? mutant : { ...mutant, closureDigest: digest }

const stampClosureDigests = (
  files: Report.FileResultDictionary,
  digests: Readonly<Record<string, string>> | undefined,
): Record<string, Report.FileResult> =>
  Object.fromEntries(
    Object.entries(files).map(([name, file]): readonly [string, Report.FileResult] => [
      name,
      {
        ...file,
        mutants: file.mutants.map((mutant) => withClosureDigest(mutant, digests?.[mutant.id])),
      },
    ]),
  )

const stampRemembered = (
  files: Record<string, Report.FileResult>,
  rememberedIds: ReadonlyArray<string>,
): Record<string, Report.FileResult> => {
  const remembered = new Set(rememberedIds)
  return Object.fromEntries(
    Object.entries(files).map(([name, file]): readonly [string, Report.FileResult] => [
      name,
      { ...file, mutants: file.mutants.map((mutant) => ({ ...mutant, remembered: remembered.has(mutant.id) })) },
    ]),
  )
}

const isCompileError = (mutant: Report.MutantResult): boolean => mutant.status === 'CompileError'

const withProgramDigest = (mutant: Report.MutantResult, digest: string | undefined): Report.MutantResult =>
  Option.match(Option.fromUndefinedOr(digest), {
    onNone: () => mutant,
    onSome: (present) =>
      Boolean.match(isCompileError(mutant), {
        onTrue: () => ({ ...mutant, programDigest: present }),
        onFalse: () => mutant,
      }),
  })

const stampProgramDigests = (
  files: Record<string, Report.FileResult>,
  digest: string | undefined,
): Record<string, Report.FileResult> =>
  Object.fromEntries(
    Object.entries(files).map(([name, file]): readonly [string, Report.FileResult] => [
      name,
      { ...file, mutants: file.mutants.map((mutant) => withProgramDigest(mutant, digest)) },
    ]),
  )

const stampFileIdentities = (
  files: Report.FileResultDictionary,
  identities: HashMap.HashMap<string, Option.Option<FormatIdentity>>,
): Record<string, FileResultWithIdentity> =>
  Object.fromEntries(
    Object.entries(files).map(([name, file]): readonly [string, FileResultWithIdentity] => [
      name,
      Option.match(Option.flatMap(HashMap.get(identities, name), (present) => present), {
        onNone: () => file,
        onSome: (identity) => ({ ...file, formatIdentity: identity }),
      }),
    ]),
  )

interface TestIdRemap {
  readonly testId: (id: TestRunner.TestId) => TestRunner.TestId
  readonly testIds: (ids: readonly string[] | undefined) => readonly TestRunner.TestId[] | undefined
}

const testIdRemap = (testIds: readonly TestRunner.TestId[]): TestIdRemap => {
  const positions = HashMap.fromIterable(
    Arr.map(testIds, (id, position): readonly [string, string] => [id, position.toString()]),
  )
  const remapId = (id: string): TestRunner.TestId =>
    TestRunner.TestId.make(Option.getOrElse(HashMap.get(positions, id), () => id))
  return {
    testId: remapId,
    testIds: (ids) =>
      Option.getOrUndefined(Option.map(Option.fromUndefinedOr(ids), (present) => Arr.map(present, remapId))),
  }
}

interface MutantGroup {
  readonly sourceFileName: string
  readonly mutants: readonly Report.MutantResult[]
}

interface TestGroup {
  readonly sourceFileName: string
  readonly tests: readonly Report.TestDefinition[]
}

interface FileResultsInput {
  readonly sources: HashMap.HashMap<string, Report.FileResult>
  readonly reportNames: HashMap.HashMap<string, string>
  readonly mutants: readonly Mutant.RunMutantResult[]
  readonly remap: TestIdRemap
  readonly timeoutEvidenceByMutantId: Readonly<Record<string, TimeoutEvidence>>
}

interface TestFilesInput {
  readonly testSources: HashMap.HashMap<string, Report.TestFile>
  readonly reportNames: HashMap.HashMap<string, string>
  readonly tests: readonly TestRunner.TestResult[]
  readonly remap: TestIdRemap
}

const presentField = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: (): Partial<Record<K, V>> => ({}),
    onSome: (present) => Record.singleton(key, present),
  })

const timeoutKindIn = (reason: string | undefined): TimeoutKind | undefined =>
  Match.value(reason).pipe(
    Match.when(TestRunner.WallClockTimeoutReason.literal, (): TimeoutKind => 'wallClock'),
    Match.when(
      (candidate: string | undefined): boolean =>
        candidate !== undefined && S.is(TestRunner.HitLimitReasonText)(candidate),
      (): TimeoutKind => 'hitLimit',
    ),
    Match.orElse((): TimeoutKind | undefined => undefined),
  )

const evidenceKindOf = (evidence: TimeoutEvidence | undefined): TimeoutKind | undefined =>
  Option.getOrUndefined(Option.map(Option.fromUndefinedOr(evidence), (present) => present.timeoutKind))

const timeoutKindOf = (
  mutant: Mutant.RunMutantResult,
  evidence: TimeoutEvidence | undefined,
): TimeoutKind | undefined =>
  Option.getOrUndefined(
    Option.firstSomeOf(
      [Option.fromUndefinedOr(timeoutKindIn(mutant.statusReason)), Option.fromUndefinedOr(evidenceKindOf(evidence))],
    ),
  )

const reproducedCountOf = (timeoutKind: TimeoutKind, evidenceKind: TimeoutKind | undefined): number =>
  Match.value(timeoutKind).pipe(
    Match.when('wallClock', () =>
      Match.value(evidenceKind).pipe(
        Match.when('wallClock', () => 1),
        Match.orElse(() => 0),
      )),
    Match.orElse(() => 0),
  )

interface PersistedTimeoutFields {
  readonly timeoutKind?: TimeoutKind
  readonly reproductions?: number
}

const timeoutFieldsOf = (
  mutant: Mutant.RunMutantResult,
  evidence: TimeoutEvidence | undefined,
): PersistedTimeoutFields =>
  Boolean.match(mutant.status === 'Timeout', {
    onFalse: (): PersistedTimeoutFields => ({}),
    onTrue: () =>
      Option.match(Option.fromUndefinedOr(timeoutKindOf(mutant, evidence)), {
        onNone: (): PersistedTimeoutFields => ({}),
        onSome: (timeoutKind) => ({
          timeoutKind,
          reproductions: reproducedCountOf(timeoutKind, evidenceKindOf(evidence)),
        }),
      }),
  })

const reportMutantOf = (
  mutant: Mutant.RunMutantResult,
  remap: TestIdRemap,
  evidence: TimeoutEvidence | undefined,
): Report.MutantResult => ({
  id: mutant.id,
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  status: mutant.status,
  location: mutant.location,
  ...presentField('statusReason', mutant.statusReason),
  ...presentField('testsCompleted', mutant.testsCompleted),
  ...presentField('description', mutant.description),
  ...presentField('static', mutant.static),
  ...presentField('killedBy', remap.testIds(mutant.killedBy)),
  ...presentField('coveredBy', remap.testIds(mutant.coveredBy)),
  ...timeoutFieldsOf(mutant, evidence),
})

const reportTestOf = (test: TestRunner.TestResult, remap: TestIdRemap) =>
  Option.match(Option.fromUndefinedOr(test.startPosition), {
    onNone: () => ({ id: remap.testId(test.id), name: test.name }),
    onSome: (start) => ({ id: remap.testId(test.id), name: test.name, location: { start } }),
  })

const groupMutants = (input: FileResultsInput): Effect.Effect<HashMap.HashMap<string, MutantGroup>> =>
  Stream.fromIterable(input.mutants).pipe(
    Stream.runFold(
      () => HashMap.empty<string, MutantGroup>(),
      (accumulator, mutant) =>
        Option.match(HashMap.get(input.reportNames, mutant.fileName), {
          onNone: () => accumulator,
          onSome: (reportName) => {
            const mapped = reportMutantOf(mutant, input.remap, input.timeoutEvidenceByMutantId[mutant.id])
            return Option.match(HashMap.get(accumulator, reportName), {
              onNone: () =>
                HashMap.set(accumulator, reportName, { sourceFileName: mutant.fileName, mutants: [mapped] }),
              onSome: (existing) =>
                HashMap.set(accumulator, reportName, {
                  sourceFileName: existing.sourceFileName,
                  mutants: [...existing.mutants, mapped],
                }),
            })
          },
        }),
    ),
  )

const groupTests = (input: TestFilesInput): Effect.Effect<HashMap.HashMap<string, TestGroup>> =>
  Stream.fromIterable(input.tests).pipe(
    Stream.runFold(
      () => HashMap.empty<string, TestGroup>(),
      (accumulator, test) =>
        Option.match(Option.fromUndefinedOr(test.fileName), {
          onNone: () => accumulator,
          onSome: (testFileName) =>
            Option.match(HashMap.get(input.reportNames, testFileName), {
              onNone: () => accumulator,
              onSome: (reportName) => {
                const mapped = reportTestOf(test, input.remap)
                return Option.match(HashMap.get(accumulator, reportName), {
                  onNone: () => HashMap.set(accumulator, reportName, { sourceFileName: testFileName, tests: [mapped] }),
                  onSome: (existing) =>
                    HashMap.set(accumulator, reportName, {
                      sourceFileName: existing.sourceFileName,
                      tests: [...existing.tests, mapped],
                    }),
                })
              },
            }),
        }),
    ),
  )

const assembleFileResults = (input: FileResultsInput): Effect.Effect<Report.FileResultDictionary> =>
  Effect.map(groupMutants(input), (grouped) =>
    Object.fromEntries(
      Arr.flatMap([...grouped], ([reportName, group]) =>
        Option.match(HashMap.get(input.sources, group.sourceFileName), {
          onNone: (): ReadonlyArray<readonly [string, Report.FileResult]> => [],
          onSome: (source): ReadonlyArray<readonly [string, Report.FileResult]> => [
            [reportName, { ...source, mutants: group.mutants }],
          ],
        })),
    ))

const assembleTestFiles = (input: TestFilesInput): Effect.Effect<Report.TestFileDefinitionDictionary> =>
  Effect.map(groupTests(input), (grouped) =>
    Object.fromEntries(
      Arr.flatMap([...grouped], ([reportName, group]) =>
        Option.match(HashMap.get(input.testSources, group.sourceFileName), {
          onNone: (): ReadonlyArray<readonly [string, Report.TestFile]> => [],
          onSome: (source): ReadonlyArray<readonly [string, Report.TestFile]> => [
            [reportName, { ...source, tests: group.tests }],
          ],
        })),
    ))

const readMutatedSources = Effect.fn(SpanTaxonomy.Spans.mutationReportingReadMutatedSources.name)(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  fileNames: readonly string[],
) {
  const { missing, present } = partitionByFile(input.project.files, fileNames)
  yield* Effect.forEach(
    missing,
    (fileName) =>
      Effect.logWarning(
        `File "${fileName}" not found in input files, but did receive mutant result for it. This shouldn't happen`,
      ),
    { discard: true },
  )
  const originals = yield* deps.projectFiles.readAllOriginal(present)
  const sources = originalSourcesOf(originals)
  return HashMap.fromIterable(Arr.map(fileNames, (fileName) => {
    const fileResult: Report.FileResult = {
      language: determineLanguage(fileName, input.formatRegistry),
      mutants: [],
      source: Option.getOrElse(HashMap.get(sources, fileName), () => ''),
    }
    return [fileName, fileResult] as const
  }))
})

const readTestSources = Effect.fn(SpanTaxonomy.Spans.mutationReportingReadTestSources.name)(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  fileNames: readonly string[],
) {
  const { missing, present } = partitionByFile(input.project.files, fileNames)
  yield* Effect.forEach(
    missing,
    (fileName) =>
      Effect.logWarning(
        `Test file "${fileName}" not found in input files, but did receive test result for it. This shouldn't happen.`,
      ),
    { discard: true },
  )
  const originals = yield* deps.projectFiles.readAllOriginal(present)
  const sources = originalSourcesOf(originals)
  return HashMap.fromIterable(Arr.map(fileNames, (fileName) =>
    Option.match(HashMap.get(sources, fileName), {
      onNone: (): readonly [string, Report.TestFile] => [fileName, { tests: [] }],
      onSome: (source): readonly [string, Report.TestFile] => [fileName, { tests: [], source }],
    })))
})

const assembleReport = Effect.fn(SpanTaxonomy.Spans.mutationReportingAssembleReport.name)(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  results: readonly Mutant.RunMutantResult[],
) {
  const tests = [...MutableHashMap.values(input.testCoverage.testsById)]
  const remap = testIdRemap(Arr.map(tests, (test) => test.id))
  const mutatedFileNames = uniqueNames(Arr.map(results, (result) => result.fileName))
  const testFileNames = uniqueNames(Arr.map(tests, (test) => test.fileName))
  const sources = yield* readMutatedSources(deps, input, mutatedFileNames)
  const testSources = yield* readTestSources(deps, input, testFileNames)
  const relativeNames = yield* S.decodeEffect(ReportFileNames)(
    Object.fromEntries(
      Arr.map([...mutatedFileNames, ...testFileNames], (fileName) =>
        [
          fileName,
          deps.path.relative(input.basePath, fileName),
        ] as const),
    ),
  ).pipe(Effect.orDie)
  const reportNames = HashMap.fromIterable(Object.entries(relativeNames))
  const identities = HashMap.fromIterable(
    mutatedFileNames.flatMap((fileName) =>
      Option.match(HashMap.get(reportNames, fileName), {
        onNone: (): ReadonlyArray<readonly [string, Option.Option<FormatIdentity>]> => [],
        onSome: (reportName) => [[reportName, identityOf(fileName, input.formatRegistry)] as const],
      })
    ),
  )
  const files = yield* assembleFileResults({
    sources,
    reportNames,
    mutants: results,
    remap,
    timeoutEvidenceByMutantId: input.timeoutEvidenceByMutantId ?? {},
  })
  const testFiles = yield* assembleTestFiles({ testSources, reportNames, tests, remap })
  return { files, testFiles, identities }
})

const manifestVersionOf = Effect.fn(SpanTaxonomy.Spans.mutationReportingManifestVersion.name)(function*(
  deps: Pick<MutationReportingDeps, 'fs' | 'path'>,
  specifier: string,
) {
  const resolved = yield* Effect.try({
    try: () => new URL(import.meta.resolve(`${specifier}/package.json`)),
    catch: (cause) => ManifestUnreadable.make({ specifier, cause }),
  })
  const manifestPath = yield* deps.path.fromFileUrl(resolved)
  const text = yield* deps.fs.readFileString(manifestPath)
  return Result.match(S.decodeResult(S.fromJsonString(ManifestSchema))(text), {
    onFailure: () => Option.none<string>(),
    onSuccess: (manifest) => Option.some(manifest.version ?? ''),
  })
})

const discoverDependencies = Effect.fn(SpanTaxonomy.Spans.mutationReportingDiscoverDependencies.name)(function*(
  deps: Pick<MutationReportingDeps, 'fs' | 'path'>,
) {
  const pairs = yield* Effect.forEach(
    MANIFEST_SPECIFIERS,
    (specifier) =>
      Effect.map(
        manifestVersionOf(deps, specifier).pipe(Effect.orElseSucceed((): Option.Option<string> => Option.none())),
        (version) => [specifier, version] as const,
      ),
    { concurrency: MANIFEST_CONCURRENCY },
  )
  return Object.fromEntries(
    Arr.flatMap(pairs, ([specifier, version]) =>
      Option.match(version, {
        onNone: (): ReadonlyArray<readonly [string, string]> => [],
        onSome: (present): ReadonlyArray<readonly [string, string]> => [[specifier, present]],
      })),
  )
})

const mutationTestReport = Effect.fn(SpanTaxonomy.Spans.mutationReportingMutationTestReport.name)(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  results: readonly Mutant.RunMutantResult[],
) {
  const { files, testFiles, identities } = yield* assembleReport(deps, input, results)
  const dependencies = yield* discoverDependencies(deps)
  const config = yield* S.encodeEffect(S.fromJsonString(S.Unknown))(input.options).pipe(
    Effect.flatMap(S.decodeEffect(S.fromJsonString(S.Record(S.String, S.Json)))),
    Effect.orDie,
  )
  const budget = budgetOf({
    results,
    concurrency: input.concurrency,
    actualSeconds: ((yield* Clock.currentTimeMillis) - input.runStartedAt) / 1000,
  })
  return {
    report: {
      files,
      schemaVersion: Report.WrittenSchemaVersion.literal,
      thresholds: input.options.thresholds,
      testFiles,
      projectRoot: input.basePath,
      config,
      framework: { ...STRYKER_FRAMEWORK, dependencies },
      budget,
    },
    identities,
  }
})

const determineExitCode = (input: MutationReportingInput) => (metrics: Report.MetricsResult) => {
  const breaking = input.options.thresholds.break
  const score = metrics.metrics.mutationScore
  const failure = Option.fromNullishOr(
    Result.match(
      classifyExit(ClassifyExitCommand.make({ pending: [], score, breakingThreshold: breaking })),
      {
        onFailure: (refused) => refused,
        onSuccess: (decision) =>
          Match.value(decision).pipe(
            Match.tag('ExitVerdictFailed', (): Plugin.ExitClass => 'VerdictFail'),
            Match.orElse((): Plugin.ExitClass | null => null),
          ),
      },
    ),
  )
  return Report.MutationScore.match(score, {
    Scored: ({ percentage }) =>
      Option.match(failure, {
        onNone: () => Effect.as(logScoredPass(breaking, percentage), null),
        onSome: (exitClass) => Effect.as(logBroken(breaking, percentage), exitClass),
      }),
    Unscored: () => Effect.as(logUnscored(breaking), Option.getOrNull(failure)),
  })
}

const logScoredPass = (breaking: number | null, percentage: number) =>
  Match.value(breaking).pipe(
    Match.when(null, () =>
      Effect.logDebug(
        "No breaking threshold configured. Won't fail the build no matter how low your mutation score is. Set `thresholds.break` to change this behavior.",
      )),
    Match.orElse((threshold) =>
      Effect.logInfo(
        `Final mutation score of ${percentage.toFixed(2)} is greater than or equal to break threshold ${
          String(threshold)
        }`,
      )
    ),
  )

const logUnscored = (breaking: number | null) =>
  Match.value(breaking).pipe(
    Match.when(null, () => Effect.void),
    Match.orElse((threshold) =>
      Effect.logInfo(
        `No valid mutant was tested, so there is no mutation score to hold against break threshold ${
          String(threshold)
        }`,
      )
    ),
  )

const logBroken = (breaking: number | null, percentage: number) =>
  Effect.andThen(
    Effect.logError(
      `Final mutation score ${percentage.toFixed(2)} under breaking threshold ${
        String(breaking)
      }, setting exit code to 1 (failure).`,
    ),
    Effect.logInfo(
      '(improve mutation score or set `thresholds.break = null` to prevent this error in the future)',
    ),
  )

const emitVerdict = Effect.fn(SpanTaxonomy.Spans.mutationReportingEmitVerdict.name)(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  report: Report.MutationTestResult,
) {
  const envelope = buildVerdictEnvelope(
    report,
    input.resolvedMode.mode,
    input.resolvedMode.signal,
    RunEvent.RunId.make(input.runId),
    input.basePath,
    deps.path,
    yield* deps.phaseClock.durations,
    staticVerdictOf(input.results),
  )
  yield* Queue.offer(
    deps.events,
    RunEvent.VerdictReached.make({
      schemaVersion: envelope.schemaVersion,
      runId: envelope.runId,
      mode: envelope.mode,
      signal: envelope.signal,
      score: envelope.score,
      thresholds: envelope.thresholds,
      reportFile: envelope.reportFile,
      counts: envelope.counts,
      mutants: envelope.mutants,
      scope: envelope.scope,
      mutantSetPolicy: envelope.mutantSetPolicy,
      incrementalMode: envelope.incrementalMode,
      phaseDurations: envelope.phaseDurations,
      static: envelope.static,
      budget: envelope.budget,
    }),
  )
})

const dryRunCoverageFieldOf = (testCoverage: TestCoverage): { readonly dryRunCoverage?: DryRunCoverage } =>
  Option.match(Option.fromUndefinedOr(testCoverage.dryRunCoverage), {
    onNone: () => ({}),
    onSome: (dryRunCoverage) => ({ dryRunCoverage }),
  })

const testTimesOf = (tests: Iterable<TestRunner.TestResult>): readonly number[] =>
  Arr.map([...tests], (test) => test.timeSpentMs)

const executedEntryOf = (result: Mutant.RunMutantResult): ReadonlyArray<readonly [string, number]> =>
  Option.match(Option.fromUndefinedOr(result.cost), {
    onNone: (): ReadonlyArray<readonly [string, number]> => [],
    onSome: (cost) => [[result.id, costTotalMsOf(cost) ?? 0] as const],
  })

const priorEntryOf = (entry: readonly [string, MutantCost]): ReadonlyArray<readonly [string, number]> =>
  entry[1].actualMs === null ? [] : [[entry[0], entry[1].actualMs] as const]

const priorCostsOf = (report: Project['incrementalReport']): Record<string, MutantCost> =>
  Option.getOrElse(
    Option.flatMap(Option.fromNullishOr(report), (present) => Option.fromNullishOr(present.costs)),
    () => ({}),
  )

const mutantCostModelOf = (
  input: MutationReportingInput,
  results: readonly Mutant.RunMutantResult[],
): MutantCostModel => ({
  subjects: Arr.map(results, (result) => ({ id: result.id, static: result.static })),
  staticCoverage: input.testCoverage.staticCoverage,
  allTestTimesMs: Arr.map([...input.testCoverage.testsById], ([, test]) => test.timeSpentMs),
  coveringTestTimesMsByMutantId: Object.fromEntries(
    [...input.testCoverage.testsByMutantId].map(([mutantId, tests]) => [mutantId, testTimesOf(tests)] as const),
  ),
  executedActualMsByMutantId: Object.fromEntries(Arr.flatMap(results, executedEntryOf)),
  priorActualMsByMutantId: Object.fromEntries(
    Arr.flatMap(Object.entries(priorCostsOf(input.project.incrementalReport)), priorEntryOf),
  ),
  fixedOverheadMs: input.timeOverheadMs,
})

const costsOf = (input: MutationReportingInput, results: readonly Mutant.RunMutantResult[]) =>
  mutantCostsOf(mutantCostModelOf(input, results))

const writeIncrementalReport = Effect.fn(SpanTaxonomy.Spans.mutationReportingWriteIncrementalReport.name)(function*(
  deps: Pick<MutationReportingDeps, 'fs' | 'path'>,
  input: MutationReportingInput,
  report: Report.MutationTestResult,
  identities: HashMap.HashMap<string, Option.Option<FormatIdentity>>,
) {
  const runInputsDigest = yield* runInputsDigestOf(deps.fs, deps.path, input.basePath, input.options)
  const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown, { space: 2 }))({
    incrementalVersion: INCREMENTAL_CACHE_VERSION,
    engineDigest: yield* engineDigestOf(deps.fs, deps.path),
    mutantSetPolicy: input.options.mutator.mutantSetPolicy,
    runInputsDigest,
    ...report,
    files: stampFileIdentities(
      stampRemembered(
        stampProgramDigests(stampClosureDigests(report.files, input.closureDigestsByMutantId), input.programDigest),
        input.rememberedMutantIds,
      ),
      identities,
    ),
    costs: costsOf(input, input.results),
    ...dryRunCoverageFieldOf(input.testCoverage),
  }).pipe(Effect.orDie)
  yield* writeFileAtomic(deps, input.options.incrementalFile, json)
})

const writeReproducers = (
  deps: Pick<MutationReportingDeps, 'fs' | 'path'>,
  input: MutationReportingInput,
  report: Report.MutationTestResult,
): Effect.Effect<void, PlatformError> => {
  const decision = Result.getOrThrow(buildReproducers(BuildReproducersCommand.make({ report })))
  return Match.value(decision).pipe(
    Match.tag('NoMutantsToReproduce', () => Effect.void),
    Match.tag('ReproducersBuilt', (built) =>
      Effect.gen(function*() {
        const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown, { space: 2 }))(built.reproducers).pipe(
          Effect.orDie,
        )
        const file = deps.path.resolve(input.basePath, REPRODUCERS_FILE)
        yield* deps.fs.makeDirectory(deps.path.dirname(file), { recursive: true })
        yield* deps.fs.writeFileString(file, json)
      })),
    Match.exhaustive,
  )
}

const reportAll = Effect.fn(SpanTaxonomy.Spans.mutationReportingReportAll.name)(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
) {
  const { report, identities } = yield* mutationTestReport(deps, input, input.results)
  const metrics = metricsResultFromFiles(report.files)
  const staticVerdict = staticVerdictOf(input.results)
  yield* offerTerminalReport(
    input.reporterStage,
    report,
    metrics,
    staticVerdict ?? undefined,
  )
  const terminalDrain = terminalDrainClass(yield* closeReporterStage(input.reporterStage))
  const verdict = yield* determineExitCode(input)(metrics)
  const finalVerdict = Result.match(
    classifyExit(
      ClassifyExitCommand.make({
        pending: [verdict, terminalDrain].filter((candidate): candidate is Plugin.ExitClass => candidate !== null),
        score: Report.MutationScore.cases.Unscored.make({}),
        breakingThreshold: null,
      }),
    ),
    {
      onFailure: (refused) => refused,
      onSuccess: (decision) =>
        Match.value(decision).pipe(
          Match.tag('ExitVerdictFailed', (): Plugin.ExitClass => 'VerdictFail'),
          Match.tag('ExitConfigErrored', (): Plugin.ExitClass => 'ConfigError'),
          Match.tag('ExitRuntimeErrored', (): Plugin.ExitClass => 'RuntimeError'),
          Match.tag('ExitInternalErrored', (): Plugin.ExitClass => 'InternalError'),
          Match.orElse((): Plugin.ExitClass | null => null),
        ),
    },
  )
  yield* emitVerdict(deps, input, report)
  yield* writeReproducers(deps, input, report)
  yield* Boolean.match(input.options.incremental, {
    onTrue: () => writeIncrementalReport(deps, input, report, identities),
    onFalse: () => Effect.void,
  })
  return { results: input.results, verdict: finalVerdict } satisfies MutationTestDone
})

const slimIncrementalReport = Effect.fn(SpanTaxonomy.Spans.mutationReportingSlimIncrementalReport.name)(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  results: readonly Mutant.RunMutantResult[],
) {
  const { files, testFiles, identities } = yield* assembleReport(deps, input, results)
  const runInputsDigest = yield* runInputsDigestOf(deps.fs, deps.path, input.basePath, input.options)
  return {
    incrementalVersion: INCREMENTAL_CACHE_VERSION,
    engineDigest: yield* engineDigestOf(deps.fs, deps.path),
    mutantSetPolicy: input.options.mutator.mutantSetPolicy,
    runInputsDigest,
    schemaVersion: Report.WrittenSchemaVersion.literal,
    thresholds: input.options.thresholds,
    files: stampFileIdentities(
      stampRemembered(
        stampProgramDigests(stampClosureDigests(files, input.closureDigestsByMutantId), input.programDigest),
        input.rememberedMutantIds,
      ),
      identities,
    ),
    costs: costsOf(input, results),
    testFiles,
    budget: budgetOf({
      results,
      concurrency: input.concurrency,
      actualSeconds: ((yield* Clock.currentTimeMillis) - input.runStartedAt) / 1000,
    }),
    ...dryRunCoverageFieldOf(input.testCoverage),
  }
})

const killedByField = (killedBy: readonly string[] | undefined) =>
  Option.match(Option.fromUndefinedOr(killedBy), {
    onNone: (): { readonly killedBy?: readonly string[] } => ({}),
    onSome: (present) => ({ killedBy: [...present] }),
  })

const settledCheckpointRowOf = (result: Mutant.RunMutantResult): CheckpointSettledMutant =>
  CheckpointSettledMutant.make({
    mutant: result,
    status: result.status,
    ...killedByField(result.killedBy),
  })

const checkpointResultOf = (row: CheckpointMutantRow): Mutant.RunMutantResult =>
  Match.valueTags(row, {
    CheckpointSettledMutant: ({ killedBy, mutant, status }) => ({
      ...mutant,
      status,
      ...killedByField(killedBy),
    }),
    CheckpointPendingMutant: ({ mutant }) => ({ ...mutant, status: 'Pending' as const }),
  })

const checkpointResultsOf = (
  input: MutationReportingInput,
  plannedMutants: readonly Mutant.Mutant[],
): readonly Mutant.RunMutantResult[] =>
  Result.match(
    checkpointMutants(
      CheckpointMutantsCommand.make({
        plannedMutants: [...plannedMutants],
        settled: input.results.map(settledCheckpointRowOf),
      }),
    ),
    {
      onFailure: (refused) => refused,
      onSuccess: (rows) => rows.map(checkpointResultOf),
    },
  )

const checkpointIncremental = Effect.fn(SpanTaxonomy.Spans.mutationReportingCheckpoint.name)(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  plannedMutants: readonly Mutant.Mutant[],
) {
  const report = yield* slimIncrementalReport(deps, input, checkpointResultsOf(input, plannedMutants))
  const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown))(report).pipe(Effect.orDie)
  yield* writeFileAtomic(deps, input.options.incrementalFile, json)
})

const checkpoint = (
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  plannedMutants: readonly Mutant.Mutant[],
) =>
  Boolean.match(input.options.incremental, {
    onTrue: () => checkpointIncremental(deps, input, plannedMutants),
    onFalse: () => Effect.void,
  })

const priorIncrementalObjectOf = (text: string): Option.Option<typeof IncrementalReportObjectSchema.Type> =>
  S.decodeOption(S.fromJsonString(IncrementalReportObjectSchema))(text)

const dryRunCoverageReportOf = Effect.fnUntraced(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  coverage: DryRunCoverage,
) {
  const prior = yield* deps.fs.readFileString(input.options.incrementalFile).pipe(Effect.option)
  return yield* Option.match(Option.flatMap(prior, priorIncrementalObjectOf), {
    onSome: (report) => Effect.succeed({ ...report, dryRunCoverage: coverage }),
    onNone: () => slimIncrementalReport(deps, input, []),
  })
})

const writeDryRunCoverage = Effect.fnUntraced(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  coverage: DryRunCoverage,
) {
  const report = yield* dryRunCoverageReportOf(deps, input, coverage)
  const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown))(report).pipe(Effect.orDie)
  yield* writeFileAtomic(deps, input.options.incrementalFile, json)
})

const publishDryRunCoverage = (deps: MutationReportingDeps, input: MutationReportingInput) =>
  Option.match(
    Option.filter(Option.fromUndefinedOr(input.testCoverage.dryRunCoverage), () => input.options.incremental),
    {
      onNone: () => Effect.void,
      onSome: (coverage) => writeDryRunCoverage(deps, input, coverage),
    },
  )

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const {
    Mutant: { Mutant, MutantStatusSchema },
    TestRunner: { MutantRunResultSchema, WallClockTimeoutReason },
  } = await import('@systemfsoftware/stryker-js-plugin-interface')

  const MAX_SOURCE_COORDINATE = 1_000_000

  const sourceCoordinateOf = (coordinate: number) => Math.min(Math.floor(Math.abs(coordinate)), MAX_SOURCE_COORDINATE)

  const coverageOf = (mutant: Mutant.Mutant): Mutant.MutantTestCoverage => ({
    _tag: mutant._tag,
    id: mutant.id,
    fileName: mutant.fileName,
    mutatorName: mutant.mutatorName,
    replacement: mutant.replacement,
    location: {
      start: {
        line: sourceCoordinateOf(mutant.location.start.line),
        column: sourceCoordinateOf(mutant.location.start.column),
      },
      end: {
        line: sourceCoordinateOf(mutant.location.end.line),
        column: sourceCoordinateOf(mutant.location.end.column),
      },
    },
    status: mutant.status,
    statusReason: mutant.statusReason,
    coveredBy: mutant.coveredBy,
    static: mutant.static,
    testsCompleted: mutant.testsCompleted,
    description: mutant.description,
  })

  const holds = (conditions: readonly boolean[]) => conditions.every((condition) => condition)

  const carriesClassOutcome = (result: TestRunner.MutantRunResult, mapped: Mutant.RunMutantResult) =>
    Match.value(result).pipe(
      Match.discriminator('status')('error', (errored) =>
        holds([
          mapped.status === 'RuntimeError',
          mapped.statusReason === errored.errorMessage,
        ])),
      Match.discriminator('status')('killed', (killed) =>
        holds([
          mapped.status === 'Killed',
          mapped.testsCompleted === killed.nrOfTests,
          mapped.statusReason === killed.failureMessage,
          JSON.stringify(mapped.killedBy) === JSON.stringify(killed.killedBy),
        ])),
      Match.discriminator('status')('timeout', (timedOut) =>
        holds([
          mapped.status === 'Timeout',
          mapped.statusReason === timedOut.reason,
        ])),
      Match.discriminator('status')('survived', (survived) =>
        holds([
          mapped.status === 'Survived',
          mapped.testsCompleted === survived.nrOfTests,
        ])),
      Match.exhaustive,
    )

  const mapForLaw = (mutant: Mutant.Mutant, result: TestRunner.MutantRunResult) =>
    mapRunResult(coverageOf(mutant), result)

  it.effect.prop(
    '∀mr_MapRunResult_≡CarriesClassOutcome',
    { of: [Mutant, MutantRunResultSchema], subject: mapForLaw },
    (subject, [mutant, result]) => Effect.map(subject(mutant, result), (mapped) => carriesClassOutcome(result, mapped)),
  )

  const reportTceIgnoredForLaw = (mutant: Mutant.Mutant, reason: string) =>
    reportIgnored(coverageOf(mutant), { status: 'ignored', reason })

  it.effect.prop(
    '∀mr_ReportIgnored_≡IgnoredCarryingTheTceReason',
    {
      of: [Mutant, S.Literals(['equivalent-to-original: tce', 'duplicate-at-site: tce'])],
      subject: reportTceIgnoredForLaw,
    },
    (subject, [mutant, reason]) =>
      Effect.map(
        subject(mutant, reason),
        (mapped) => holds([mapped.status === 'Ignored', mapped.statusReason === reason]),
      ),
  )

  const expectedTimeoutKind = (
    result: Parameters<typeof timeoutFieldsOf>[0],
    evidence: { readonly timeoutKind: TimeoutKind; readonly reproductions: number },
  ): TimeoutKind =>
    Match.value(result.statusReason).pipe(
      Match.when('wall-clock-timeout', (): TimeoutKind => 'wallClock'),
      Match.when(
        (reason: string | undefined): boolean =>
          reason !== undefined && /^Hit limit reached \(\d+\/\d+\)$/.test(reason),
        (): TimeoutKind => 'hitLimit',
      ),
      Match.orElse((): TimeoutKind => evidence.timeoutKind),
    )

  const expectedReproductions = (
    timeoutKind: TimeoutKind,
    evidence: { readonly timeoutKind: TimeoutKind },
  ): number =>
    Match.value(timeoutKind).pipe(
      Match.when('wallClock', () =>
        Match.value(evidence.timeoutKind).pipe(
          Match.when('wallClock', () => 1),
          Match.orElse(() => 0),
        )),
      Match.orElse(() => 0),
    )

  const expectedTimeoutFields = (
    result: Parameters<typeof timeoutFieldsOf>[0],
    evidence: { readonly timeoutKind: TimeoutKind; readonly reproductions: number },
  ) =>
    Match.value(result.status === 'Timeout').pipe(
      Match.when(true, () => ({
        timeoutKind: expectedTimeoutKind(result, evidence),
        reproductions: expectedReproductions(expectedTimeoutKind(result, evidence), evidence),
      })),
      Match.orElse(() => ({ timeoutKind: undefined, reproductions: undefined })),
    )

  interface TimeoutProbe {
    readonly result: Mutant.RunMutantResult
    readonly evidence: TimeoutEvidence | undefined
    readonly expected: PersistedTimeoutFields
  }

  /**
   * Inputs whose persisted timeout fields are known without the subject's logic: a wall-clock
   * timeout is credited only beside wall-clock evidence, a hit-limit timeout is never credited
   * as reproduced, and a non-timeout carries no timeout fields. The probes disagree with one
   * another, so they refute a constant impostor even when the draw holds no timeout case for
   * the model comparison to catch.
   */
  const timeoutProbes = (mutant: Mutant.Mutant): readonly TimeoutProbe[] => [
    {
      result: { ...mutant, status: 'Timeout', statusReason: WallClockTimeoutReason.literal },
      evidence: { timeoutKind: 'wallClock', reproductions: 3 },
      expected: { timeoutKind: 'wallClock', reproductions: 1 },
    },
    {
      result: { ...mutant, status: 'Timeout', statusReason: WallClockTimeoutReason.literal },
      evidence: { timeoutKind: 'hitLimit', reproductions: 7 },
      expected: { timeoutKind: 'wallClock', reproductions: 0 },
    },
    {
      result: { ...mutant, status: 'Timeout', statusReason: WallClockTimeoutReason.literal },
      evidence: undefined,
      expected: { timeoutKind: 'wallClock', reproductions: 0 },
    },
    {
      result: { ...mutant, status: 'Timeout', statusReason: 'Hit limit reached (3/10)' },
      evidence: { timeoutKind: 'wallClock', reproductions: 7 },
      expected: { timeoutKind: 'hitLimit', reproductions: 0 },
    },
    {
      result: { ...mutant, status: 'Survived', statusReason: WallClockTimeoutReason.literal },
      evidence: { timeoutKind: 'wallClock', reproductions: 7 },
      expected: {},
    },
  ]

  const timeoutProbesHold = (subject: typeof timeoutFieldsOf, mutant: Mutant.Mutant): boolean =>
    Arr.every(
      timeoutProbes(mutant),
      ({ result, evidence, expected }) => JSON.stringify(subject(result, evidence)) === JSON.stringify(expected),
    )

  it.prop(
    '∀mse_MutantStatusAndEvidence_≡PersistedTimeoutFieldsFollowTheReproductionRule',
    { of: [Mutant, MutantStatusSchema, TimeoutEvidenceSchema], subject: timeoutFieldsOf },
    (subject, [mutant, status, evidence]) => {
      const result: Parameters<typeof timeoutFieldsOf>[0] = { ...mutant, status }
      return holds([
        JSON.stringify(subject(result, evidence)) === JSON.stringify(expectedTimeoutFields(result, evidence)),
        timeoutProbesHold(subject, mutant),
      ])
    },
  )
}
