import type { MutantTestCoverage, RunMutantResult } from '@systemfsoftware/stryker-js-instrumenter'
import type * as Cause from 'effect/Cause'
import type {
  CheckResult,
  CheckStatus,
  ExitClass,
  MetricsResult,
  MutantRunResult,
  PassedCheckResult,
} from '@systemfsoftware/stryker-js-plugin-interface'
import type * as schema from '@systemfsoftware/stryker-js-plugin-interface'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
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

import { calculateMetrics } from './calculate-metrics.js'
import { classifyExit, ClassifyExitCommand } from './classify-exit.workflow.js'
import { ReportLocationFromMutant } from './ReportLocation.schema.js'
import { ManifestSchema, ManifestUnreadable } from './mutation-reporting.schema.js'
import type { ResolvedMode } from './output-mode.schema.js'
import type { Project, ProjectFile } from './Project.schema.js'
import { ProjectFiles, type ProjectFilesShape } from './project-files.service.js'
import type { RunEvent } from './run-event.schema.js'
import { RunEvents, VerdictReached } from './run-events.service.js'
import {
  assembleFileResults,
  assembleTestFiles,
  determineLanguage,
  reportFileName,
  testIdRemap,
} from './report-assembly.js'
import type { ReporterStage } from './reporter-stream.service.js'
import { closeReporterStage, offerTerminalReport, terminalDrainClass } from './reporter-stream.service.js'
import type { MutationTestDone } from './run/mutation-test.cell.js'
import { strykerVersion } from './stryker-package.js'
import type { TestCoverage } from './test-coverage.schema.js'
import { buildVerdictEnvelope } from './verdict-envelope.js'

const STRYKER_FRAMEWORK: Readonly<Pick<schema.FrameworkInformation, 'branding' | 'name' | 'version'>> = Object.freeze({
  branding: {
    homepageUrl: 'https://stryker-mutator.io',
    imageUrl: 'https://stryker-mutator.io/assets/images/stryker-80x80.png',
  },
  name: 'StrykerJS',
  version: strykerVersion,
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
  readonly results: readonly RunMutantResult[]
  readonly options: StrykerOptions
  readonly project: Project
  readonly testCoverage: TestCoverage
  readonly runId: string
  readonly resolvedMode: ResolvedMode
  readonly basePath: string
  readonly reporterStage: ReporterStage
}

export interface MutationReportingService {
  readonly reportCheckFailure: (
    mutant: MutantTestCoverage,
    result: Exclude<CheckResult, PassedCheckResult>,
  ) => Effect.Effect<RunMutantResult>
  readonly reportMutantRunResult: (
    mutant: MutantTestCoverage,
    result: MutantRunResult,
  ) => Effect.Effect<RunMutantResult>
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
  mutant: MutantTestCoverage,
  status: RunMutantResult['status'],
  outcome: MutantOutcome = {},
) =>
  Effect.map(S.decodeEffect(ReportLocationFromMutant)(mutant.location), (location): RunMutantResult => ({
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
  })).pipe(Effect.orDie)

const checkStatusToMutantStatus = (_status: Exclude<CheckStatus, 'passed'>) => 'CompileError'

const reportMutantStatus = (mutant: MutantTestCoverage, status: RunMutantResult['status'], statusReason?: string) =>
  reportMutant(mutant, status, { statusReason: statusReason ?? mutant.statusReason })

const reportCheckFailure = (mutant: MutantTestCoverage, result: Exclude<CheckResult, PassedCheckResult>) =>
  reportMutantStatus(mutant, checkStatusToMutantStatus(result.status), result.reason)

const reasonedOutcomeOf = (reason: string | undefined) =>
  Option.match(Option.fromNullishOr(reason), {
    onNone: () => ({}),
    onSome: (present) => ({ statusReason: present }),
  })

const mapRunResult = (mutant: MutantTestCoverage, result: MutantRunResult) =>
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
    Match.discriminator('status')('timeout', (timedOut) =>
      reportMutant(mutant, 'Timeout', reasonedOutcomeOf(timedOut.reason))),
    Match.discriminator('status')(
      'survived',
      (survived) => reportMutant(mutant, 'Survived', { testsCompleted: survived.nrOfTests }),
    ),
    Match.exhaustive,
  )

const uniqueNames = (names: readonly (string | undefined)[]): readonly string[] =>
  Arr.dedupe(Arr.filter(names, (name): name is string => name !== undefined))

const partitionByFile = (files: Project['files'], fileNames: readonly string[]) => {
  const [missing, present] = Arr.separate(Arr.map(fileNames, (fileName) =>
    Option.match(MutableHashMap.get(files, fileName), {
      onNone: () => Result.fail(fileName),
      onSome: (file) => Result.succeed(file),
    })))
  return { missing, present }
}

const originalSourcesOf = (originals: readonly (readonly [ProjectFile, string])[]) =>
  HashMap.fromIterable(Arr.map(originals, ([file, content]) => [file.name, content] as const))

const readMutatedSources =
  (deps: MutationReportingDeps, input: MutationReportingInput) => (fileNames: readonly string[]) =>
    Effect.gen(function*() {
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
        const fileResult: schema.FileResult = {
          language: determineLanguage(fileName),
          mutants: [],
          source: Option.getOrElse(HashMap.get(sources, fileName), () => ''),
        }
        return [fileName, fileResult] as const
      }))
    })

const readTestSources = (deps: MutationReportingDeps, input: MutationReportingInput) => (fileNames: readonly string[]) =>
  Effect.gen(function*() {
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
        onNone: (): readonly [string, schema.TestFile] => [fileName, { tests: [] }],
        onSome: (source): readonly [string, schema.TestFile] => [fileName, { tests: [], source }],
      })))
  })

const assembleReport = (deps: MutationReportingDeps, input: MutationReportingInput) => (results: readonly RunMutantResult[]) =>
  Effect.gen(function*() {
    const tests = [...MutableHashMap.values(input.testCoverage.testsById)]
    const remap = testIdRemap(Arr.map(tests, (test) => test.id))
    const mutatedFileNames = uniqueNames(Arr.map(results, (result) => result.fileName))
    const testFileNames = uniqueNames(Arr.map(tests, (test) => test.fileName))
    const sources = yield* readMutatedSources(deps, input)(mutatedFileNames)
    const testSources = yield* readTestSources(deps, input)(testFileNames)
    const reportNames = HashMap.fromIterable(
      Arr.map([...mutatedFileNames, ...testFileNames], (fileName) => [
        fileName,
        reportFileName(deps.path.relative(input.basePath, fileName)),
      ] as const),
    )
    return {
      files: assembleFileResults({ sources, reportNames, mutants: results, remap }),
      testFiles: assembleTestFiles({ testSources, reportNames, tests, remap }),
    }
  })

const manifestVersionOf = (deps: Pick<MutationReportingDeps, 'fs' | 'path'>) => (specifier: string) =>
  Effect.gen(function*() {
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
  }).pipe(Effect.orElseSucceed(() => Option.none<string>()))

const discoverDependencies = (deps: Pick<MutationReportingDeps, 'fs' | 'path'>) =>
  Effect.gen(function*() {
    const pairs = yield* Effect.forEach(
      MANIFEST_SPECIFIERS,
      (specifier) => Effect.map(manifestVersionOf(deps)(specifier), (version) => [specifier, version] as const),
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

const mutationTestReport =
  (deps: MutationReportingDeps, input: MutationReportingInput) => (results: readonly RunMutantResult[]) =>
    Effect.gen(function*() {
      const { files, testFiles } = yield* assembleReport(deps, input)(results)
      const dependencies = yield* discoverDependencies(deps)
      return {
        files,
        schemaVersion: '1.0',
        thresholds: input.options.thresholds,
        testFiles,
        projectRoot: input.basePath,
        config: input.options,
        framework: { ...STRYKER_FRAMEWORK, dependencies },
      }
    })

const determineExitCode = (input: MutationReportingInput) => (metrics: MetricsResult) =>
  Effect.gen(function*() {
    const { mutationScore } = metrics.metrics
    const breaking = input.options.thresholds.break
    const formattedScore = mutationScore.toFixed(2)
    return yield* Option.match(
      Option.fromNullishOr(
        Result.match(
          classifyExit(
            new ClassifyExitCommand({ pending: [], signal: null, score: mutationScore, breakingThreshold: breaking }),
          ),
          {
            onFailure: (refused) => refused,
            onSuccess: (decision) => decision.verdictClass,
          },
        ),
      ),
      {
        onNone: () =>
          Effect.map(
            Match.value(breaking).pipe(
              Match.when(null, () =>
                Effect.logDebug(
                  "No breaking threshold configured. Won't fail the build no matter how low your mutation score is. Set `thresholds.break` to change this behavior.",
                )),
              Match.orElse((threshold) =>
                Effect.logInfo(
                  `Final mutation score of ${formattedScore} is greater than or equal to break threshold ${
                    String(threshold)
                  }`,
                )
              ),
            ),
            (): ExitClass | null => null,
          ),
        onSome: (failure) =>
          Effect.map(
            Effect.andThen(
              Effect.logError(
                `Final mutation score ${formattedScore} under breaking threshold ${
                  String(breaking)
                }, setting exit code to 1 (failure).`,
              ),
              Effect.logInfo(
                '(improve mutation score or set `thresholds.break = null` to prevent this error in the future)',
              ),
            ),
            (): ExitClass | null => failure,
          ),
      })
  })

const emitVerdict = (deps: MutationReportingDeps, input: MutationReportingInput) => (report: schema.MutationTestResult) =>
  Effect.gen(function*() {
    const envelope = buildVerdictEnvelope(
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

const writeIncrementalReport = (
  deps: Pick<MutationReportingDeps, 'fs' | 'path'>,
  input: MutationReportingInput,
  report: schema.MutationTestResult,
) =>
  Effect.gen(function*() {
    yield* deps.fs.makeDirectory(deps.path.dirname(input.options.incrementalFile), { recursive: true })
    const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown, { space: 2 }))({
      incrementalVersion: strykerVersion,
      ...report,
    }).pipe(Effect.orDie)
    yield* deps.fs.writeFileString(input.options.incrementalFile, json)
  })

const reportAll = (deps: MutationReportingDeps, input: MutationReportingInput) =>
  Effect.gen(function*() {
    const report = yield* mutationTestReport(deps, input)(input.results)
    const metrics = calculateMetrics(report.files)
    yield* offerTerminalReport(input.reporterStage, report, metrics)
    const terminalDrain = terminalDrainClass(yield* closeReporterStage(input.reporterStage))
    const verdict = yield* determineExitCode(input)(metrics)
    const finalVerdict = Result.match(
      classifyExit(
        new ClassifyExitCommand({
          pending: [verdict, terminalDrain].filter((candidate): candidate is ExitClass => candidate !== null),
          signal: null,
          score: null,
          breakingThreshold: null,
        }),
      ),
      {
        onFailure: (refused) => refused,
        onSuccess: (decision) => decision.highestClass,
      },
    )
    yield* emitVerdict(deps, input)(report)
    yield* Boolean.match(input.options.incremental, {
      onTrue: () => writeIncrementalReport(deps, input, report),
      onFalse: () => Effect.void,
    })
    return { results: input.results, verdict: finalVerdict } satisfies MutationTestDone
  })

const writeAtomic = (deps: Pick<MutationReportingDeps, 'fs' | 'path'>) => (file: string, content: string) =>
  Effect.gen(function*() {
    yield* deps.fs.makeDirectory(deps.path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    yield* deps.fs.writeFileString(tmp, content)
    yield* deps.fs.rename(tmp, file).pipe(
      Effect.catch(() => deps.fs.copyFile(tmp, file).pipe(Effect.andThen(deps.fs.remove(tmp)))),
    )
  })

const slimIncrementalReport =
  (deps: MutationReportingDeps, input: MutationReportingInput) => (results: readonly RunMutantResult[]) =>
    Effect.gen(function*() {
      const { files, testFiles } = yield* assembleReport(deps, input)(results)
      return {
        incrementalVersion: strykerVersion,
        schemaVersion: '1.0',
        thresholds: input.options.thresholds,
        files,
        testFiles,
      }
    })

const checkpoint = (deps: MutationReportingDeps, input: MutationReportingInput) =>
  Boolean.match(input.options.incremental, {
    onTrue: () =>
      Effect.gen(function*() {
        const report = yield* slimIncrementalReport(deps, input)(input.results)
        const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown))(report).pipe(Effect.orDie)
        yield* writeAtomic(deps)(input.options.incrementalFile, json)
      }),
    onFalse: () => Effect.void,
  })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Mutant } = await import('@systemfsoftware/stryker-js-instrumenter')
  const { MutantRunResultSchema } = await import('@systemfsoftware/stryker-js-plugin-interface')

  const coverageOf = (mutant: Mutant): MutantTestCoverage => ({
    ...mutant,
    coveredBy: mutant.coveredBy,
    static: mutant.static,
  })

  const conservesMutant = (coverage: MutantTestCoverage, mapped: RunMutantResult) =>
    mapped.id === coverage.id &&
    mapped.fileName === coverage.fileName &&
    mapped.mutatorName === coverage.mutatorName &&
    mapped.replacement === coverage.replacement &&
    mapped.coveredBy === coverage.coveredBy &&
    mapped.static === coverage.static &&
    mapped.description === coverage.description

  const shiftsLocationByOne = (coverage: MutantTestCoverage, mapped: RunMutantResult) =>
    mapped.location.start.line - coverage.location.start.line === 1 &&
    mapped.location.start.column - coverage.location.start.column === 1 &&
    mapped.location.end.line - coverage.location.end.line === 1 &&
    mapped.location.end.column - coverage.location.end.column === 1

  const carriesClassOutcome = (result: MutantRunResult, mapped: RunMutantResult) =>
    Match.value(result).pipe(
      Match.discriminator('status')('error', (errored) =>
        mapped.status === 'RuntimeError' && mapped.statusReason === errored.errorMessage),
      Match.discriminator('status')('killed', (killed) =>
        mapped.status === 'Killed' &&
        mapped.testsCompleted === killed.nrOfTests &&
        mapped.statusReason === killed.failureMessage &&
        JSON.stringify(mapped.killedBy) === JSON.stringify(killed.killedBy)),
      Match.discriminator('status')('timeout', (timedOut) =>
        mapped.status === 'Timeout' && mapped.statusReason === timedOut.reason),
      Match.discriminator('status')('survived', (survived) =>
        mapped.status === 'Survived' && mapped.testsCompleted === survived.nrOfTests),
      Match.exhaustive,
    )

  const mapsFaithfully = (mutant: Mutant, result: MutantRunResult) => {
    const coverage = coverageOf(mutant)
    return Effect.map(mapRunResult(coverage, result), (mapped) =>
      conservesMutant(coverage, mapped) && shiftsLocationByOne(coverage, mapped) &&
      carriesClassOutcome(result, mapped))
  }

  it.effect.prop(
    '∀mr_MapRunResult_ConservesMutant∧ShiftsLocation∧CarriesOutcome',
    [Mutant, MutantRunResultSchema],
    ([mutant, result]) => mapsFaithfully(mutant, result),
  )
}
