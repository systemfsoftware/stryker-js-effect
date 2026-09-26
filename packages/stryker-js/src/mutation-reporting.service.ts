import { Format, Mutant as InstrumenterMutant } from '@systemfsoftware/stryker-js-instrumenter'
import {
  type Checker,
  type Options,
  type Plugin,
  Report,
  type TestRunner,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import type * as Cause from 'effect/Cause'
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
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { classifyExit, ClassifyExitCommand } from './classify-exit.workflow.js'
import type { FormatIdentity } from './IncrementalDiff.schema.js'
import { ManifestSchema, ManifestUnreadable } from './mutation-reporting.schema.js'
import type { ResolvedMode } from './output-mode.schema.js'
import { ProjectFiles, type ProjectFilesShape } from './project-files.service.js'
import type { Project, ProjectFile } from './Project.schema.js'
import type { ReporterStage } from './reporter-stream.service.js'
import { closeReporterStage, offerTerminalReport, terminalDrainClass } from './reporter-stream.service.js'
import { MetricsResultFromReport } from './reporting/metrics-from-report.schema.js'
import { ReportFileNames } from './reporting/report-assembly.schema.js'
import { VerdictEnvelope } from './reporting/verdict-envelope.schema.js'
import type { RunEvent } from './run-event.schema.js'
import { RunEvents, VerdictReached } from './run-events.service.js'
import type { MutationTestDone } from './run/mutation-test.cell.js'
import { StrykerPackage } from './stryker-package.schema.js'
import type { TestCoverage } from './test-coverage.schema.js'

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
  readonly results: readonly InstrumenterMutant.RunMutantResult[]
  readonly options: Options.StrykerOptions
  readonly project: Project
  readonly testCoverage: TestCoverage
  readonly runId: string
  readonly resolvedMode: ResolvedMode
  readonly basePath: string
  readonly reporterStage: ReporterStage
  readonly formatRegistry: Format.FormatRegistry
}

export interface MutationReportingService {
  readonly reportCheckFailure: (
    mutant: InstrumenterMutant.MutantTestCoverage,
    result: Exclude<Checker.CheckResult, Checker.PassedCheckResult>,
  ) => Effect.Effect<InstrumenterMutant.RunMutantResult>
  readonly reportMutantRunResult: (
    mutant: InstrumenterMutant.MutantTestCoverage,
    result: TestRunner.MutantRunResult,
  ) => Effect.Effect<InstrumenterMutant.RunMutantResult>
  readonly reportAll: (input: MutationReportingInput) => Effect.Effect<MutationTestDone, PlatformError>
  readonly checkpoint: (input: MutationReportingInput) => Effect.Effect<void, PlatformError>
}

export class MutationReporting extends Context.Service<MutationReporting, MutationReportingService>()(
  '@systemfsoftware/stryker-js/mutation-reporting.service/MutationReporting',
) {
  static readonly layer: Layer.Layer<
    MutationReporting,
    never,
    FileSystem.FileSystem | Path.Path | RunEvents | ProjectFiles
  > = Layer.effect(
    MutationReporting,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const events = yield* RunEvents
      const projectFiles: ProjectFilesShape = yield* ProjectFiles
      const deps: MutationReportingDeps = { fs, path: pathService, events, projectFiles }
      return MutationReporting.of({
        reportCheckFailure: (mutant, result) => reportCheckFailure(mutant, result),
        reportMutantRunResult: (mutant, result) => mapRunResult(mutant, result),
        reportAll: (input) => reportAll(deps, input),
        checkpoint: (input) => checkpoint(deps, input),
      })
    }),
  )
}

interface MutationReportingDeps {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly events: Queue.Queue<RunEvent, Cause.Done>
  readonly projectFiles: ProjectFilesShape
}

interface MutantOutcome {
  readonly killedBy?: readonly string[] | undefined
  readonly statusReason?: string | undefined
  readonly testsCompleted?: number | undefined
}

const reportMutant = (
  mutant: InstrumenterMutant.MutantTestCoverage,
  status: InstrumenterMutant.RunMutantResult['status'],
  outcome: MutantOutcome = {},
) =>
  Effect.map(
    S.decodeEffect(InstrumenterMutant.ReportLocationFromMutant)(mutant.location),
    (location): InstrumenterMutant.RunMutantResult => ({
      _tag: 'Mutant',
      id: mutant.id,
      fileName: mutant.fileName,
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location,
      status,
      coveredBy: mutant.coveredBy,
      static: mutant.static,
      testsCompleted: mutant.testsCompleted,
      description: mutant.description,
      ...outcome,
    }),
  ).pipe(Effect.orDie)

const checkStatusToMutantStatus = (
  _status: Exclude<Checker.CheckStatus, 'passed'>,
): InstrumenterMutant.RunMutantResult['status'] => 'CompileError'

const reportMutantStatus = (
  mutant: InstrumenterMutant.MutantTestCoverage,
  status: InstrumenterMutant.RunMutantResult['status'],
  statusReason?: string,
) => reportMutant(mutant, status, { statusReason: statusReason ?? mutant.statusReason })

const reportCheckFailure = (
  mutant: InstrumenterMutant.MutantTestCoverage,
  result: Exclude<Checker.CheckResult, Checker.PassedCheckResult>,
) => reportMutantStatus(mutant, checkStatusToMutantStatus(result.status), result.reason)

const reasonedOutcomeOf = (reason: string | undefined) =>
  Option.match(Option.fromNullishOr(reason), {
    onNone: () => ({}),
    onSome: (present) => ({ statusReason: present }),
  })

const mapRunResult = (mutant: InstrumenterMutant.MutantTestCoverage, result: TestRunner.MutantRunResult) =>
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
  const [missing, present] = Arr.separate(
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
  readonly testId: (id: string) => string
  readonly testIds: (ids: readonly string[] | undefined) => readonly string[] | undefined
}

const testIdRemap = (testIds: readonly string[]): TestIdRemap => {
  const positions = HashMap.fromIterable(
    Arr.map(testIds, (id, position): readonly [string, string] => [id, position.toString()]),
  )
  const remapId = (id: string): string => Option.getOrElse(HashMap.get(positions, id), () => id)
  return {
    testId: remapId,
    testIds: (ids) =>
      Option.match(Option.fromUndefinedOr(ids), {
        onNone: () => undefined,
        onSome: (present) => Arr.map(present, remapId),
      }),
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
  readonly mutants: readonly InstrumenterMutant.RunMutantResult[]
  readonly remap: TestIdRemap
}

interface TestFilesInput {
  readonly testSources: HashMap.HashMap<string, Report.TestFile>
  readonly reportNames: HashMap.HashMap<string, string>
  readonly tests: readonly TestRunner.TestResult[]
  readonly remap: TestIdRemap
}

const reportMutantOf = (
  mutant: InstrumenterMutant.RunMutantResult,
  remap: TestIdRemap,
): Report.MutantResult => ({
  id: mutant.id,
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  status: mutant.status,
  location: mutant.location,
  statusReason: mutant.statusReason,
  testsCompleted: mutant.testsCompleted,
  description: mutant.description,
  static: mutant.static,
  killedBy: remap.testIds(mutant.killedBy),
  coveredBy: remap.testIds(mutant.coveredBy),
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
            const mapped = reportMutantOf(mutant, input.remap)
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

const readMutatedSources = Effect.fn('stryker.mutationReporting.readMutatedSources')(function*(
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

const readTestSources = Effect.fn('stryker.mutationReporting.readTestSources')(function*(
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

const assembleReport = Effect.fn('stryker.mutationReporting.assembleReport')(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  results: readonly InstrumenterMutant.RunMutantResult[],
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
  const files = yield* assembleFileResults({ sources, reportNames, mutants: results, remap })
  const testFiles = yield* assembleTestFiles({ testSources, reportNames, tests, remap })
  return { files, testFiles, identities }
})

const manifestVersionOf = Effect.fn('stryker.mutationReporting.manifestVersion')(function*(
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

const discoverDependencies = Effect.fn('stryker.mutationReporting.discoverDependencies')(function*(
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

const mutationTestReport = Effect.fn('stryker.mutationReporting.mutationTestReport')(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  results: readonly InstrumenterMutant.RunMutantResult[],
) {
  const { files, testFiles, identities } = yield* assembleReport(deps, input, results)
  const dependencies = yield* discoverDependencies(deps)
  return {
    report: {
      files,
      schemaVersion: '1.0',
      thresholds: input.options.thresholds,
      testFiles,
      projectRoot: input.basePath,
      config: input.options,
      framework: { ...STRYKER_FRAMEWORK, dependencies },
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

const emitVerdict = Effect.fn('stryker.mutationReporting.emitVerdict')(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  report: Report.MutationTestResult,
) {
  const envelope = VerdictEnvelope.build(
    report,
    input.resolvedMode.mode,
    input.resolvedMode.signal,
    input.runId,
    input.basePath,
    deps.path,
  )
  yield* Queue.offer(
    deps.events,
    VerdictReached.make({
      schemaVersion: envelope.schemaVersion,
      runId: envelope.runId,
      mode: envelope.mode,
      signal: envelope.signal,
      score: envelope.score,
      thresholds: envelope.thresholds,
      reportFile: envelope.reportFile,
      counts: envelope.counts,
      mutants: envelope.mutants,
    }),
  )
})

const writeIncrementalReport = Effect.fn('stryker.mutationReporting.writeIncrementalReport')(function*(
  deps: Pick<MutationReportingDeps, 'fs' | 'path'>,
  input: MutationReportingInput,
  report: Report.MutationTestResult,
  identities: HashMap.HashMap<string, Option.Option<FormatIdentity>>,
) {
  yield* deps.fs.makeDirectory(deps.path.dirname(input.options.incrementalFile), { recursive: true })
  const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown, { space: 2 }))({
    incrementalVersion: StrykerPackage.version,
    ...report,
    files: stampFileIdentities(report.files, identities),
  }).pipe(Effect.orDie)
  yield* deps.fs.writeFileString(input.options.incrementalFile, json)
})

const reportAll = Effect.fn('stryker.mutationReporting.reportAll')(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
) {
  const { report, identities } = yield* mutationTestReport(deps, input, input.results)
  const metrics = MetricsResultFromReport.fromFiles(report.files)
  yield* offerTerminalReport(input.reporterStage, report, metrics)
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
  yield* Boolean.match(input.options.incremental, {
    onTrue: () => writeIncrementalReport(deps, input, report, identities),
    onFalse: () => Effect.void,
  })
  return { results: input.results, verdict: finalVerdict } satisfies MutationTestDone
})

const writeAtomic = Effect.fn('stryker.mutationReporting.writeAtomic')(function*(
  deps: Pick<MutationReportingDeps, 'fs' | 'path'>,
  file: string,
  content: string,
) {
  yield* deps.fs.makeDirectory(deps.path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  yield* deps.fs.writeFileString(tmp, content)
  yield* deps.fs.rename(tmp, file).pipe(
    Effect.catch(() => deps.fs.copyFile(tmp, file).pipe(Effect.andThen(deps.fs.remove(tmp)))),
  )
})

const slimIncrementalReport = Effect.fn('stryker.mutationReporting.slimIncrementalReport')(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
  results: readonly InstrumenterMutant.RunMutantResult[],
) {
  const { files, testFiles, identities } = yield* assembleReport(deps, input, results)
  return {
    incrementalVersion: StrykerPackage.version,
    schemaVersion: '1.0',
    thresholds: input.options.thresholds,
    files: stampFileIdentities(files, identities),
    testFiles,
  }
})

const checkpointIncremental = Effect.fn('stryker.mutationReporting.checkpoint')(function*(
  deps: MutationReportingDeps,
  input: MutationReportingInput,
) {
  const report = yield* slimIncrementalReport(deps, input, input.results)
  const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown))(report).pipe(Effect.orDie)
  yield* writeAtomic(deps, input.options.incrementalFile, json)
})

const checkpoint = (deps: MutationReportingDeps, input: MutationReportingInput) =>
  Boolean.match(input.options.incremental, {
    onTrue: () => checkpointIncremental(deps, input),
    onFalse: () => Effect.void,
  })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { Mutant: { Mutant } } = await import('@systemfsoftware/stryker-js-instrumenter')
  const { TestRunner: { MutantRunResultSchema } } = await import('@systemfsoftware/stryker-js-plugin-interface')

  const MAX_SOURCE_COORDINATE = 1_000_000

  const sourceCoordinateOf = (coordinate: number) => Math.min(Math.floor(Math.abs(coordinate)), MAX_SOURCE_COORDINATE)

  const coverageOf = (mutant: InstrumenterMutant.Mutant): InstrumenterMutant.MutantTestCoverage => ({
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

  const carriesClassOutcome = (result: TestRunner.MutantRunResult, mapped: InstrumenterMutant.RunMutantResult) =>
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

  const mapForLaw = (mutant: InstrumenterMutant.Mutant, result: TestRunner.MutantRunResult) =>
    mapRunResult(coverageOf(mutant), result)

  it.effect.prop(
    '∀mr_MapRunResult_≡CarriesClassOutcome',
    { of: [Mutant, MutantRunResultSchema], subject: mapForLaw },
    (subject, [mutant, result]) => Effect.map(subject(mutant, result), (mapped) => carriesClassOutcome(result, mapped)),
  )
}
