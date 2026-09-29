import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

import { ReproducerList, SarifDocument } from './__fixtures__/sarif-reporter.schema.js'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const TARGET_FILE = 'src/target.ts'
const TARGET_SOURCE = [
  'export const target = (value: number): number => {',
  '  const doubled = value * 2',
  '  return doubled + 1',
  '}',
  '',
].join('\n')

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const ANNOTATE_REPORT_FILE = 'reports/mutation/mutation.json'
const ANNOTATE_BASELINE_FILE = 'baseline.json'
const ANNOTATE_TARGET_FILE = 'src/odd,name:one.js'
const ANNOTATE_SURVIVOR = '7a7a7a7a7a7a7a7a'
const ANNOTATE_SHADOWED_SURVIVOR = '8b8b8b8b8b8b8b8b'
const ANNOTATE_KILLED = '9c9c9c9c9c9c9c9c'

const CONSUMER_PACKAGE = '{ "name": "annotation-consumer", "type": "module", "private": true }\n'

const CONSUMER_CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  concurrency: 1,
  reporters: ['clear-text'],
}
`

const mutantLine = (id: string, line: number, status: string): string =>
  `    { "id": "${id}", "mutatorName": "ArithmeticOperator", "replacement": "-", "status": "${status}", "location": { "start": { "line": ${line}, "column": 26 }, "end": { "line": ${line}, "column": 27 } } }`

const ANNOTATE_REPORT_JSON = `{
  "schemaVersion": "1",
  "thresholds": { "high": 80, "low": 60, "break": null },
  "files": {
    "${ANNOTATE_TARGET_FILE}": {
      "language": "javascript",
      "source": "export const sum = (a, b) => a + b\\n",
      "mutants": [
${
  [
    mutantLine(ANNOTATE_SURVIVOR, 1, 'Survived'),
    mutantLine(ANNOTATE_SHADOWED_SURVIVOR, 1, 'Survived'),
    mutantLine(ANNOTATE_KILLED, 2, 'Killed'),
  ].join(',\n')
}
      ]
    }
  }
}
`

const ANNOTATE_BASELINE_JSON = `{ "schemaVersion": 1, "survivors": ["${ANNOTATE_SURVIVOR}"] }\n`

interface Workspace {
  readonly directory: string
}

const reportFileOf = (directory: string): string => `${directory}/reports/mutation/mutation.json`
const sarifFileOf = (directory: string): string => `${directory}/reports/mutation/mutation.sarif`
const reproducersFileOf = (directory: string): string => `${directory}/reports/mutation/reproducers.json`

const writeWorkspace = (): Effect.Effect<Workspace, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    const files: ReadonlyArray<readonly [string, string]> = [
      ['package.json', '{ "type": "commonjs" }\n'],
      [TARGET_FILE, TARGET_SOURCE],
    ]
    yield* Effect.forEach(
      files,
      ([name, content]) =>
        Effect.gen(function*() {
          const target = path.join(directory, name)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    return { directory }
  }).pipe(Effect.orDie)

const removeWorkspace = (directory: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.orDie(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })),
  )

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

const parseReport = (text: string | undefined): Option.Option<Report.MutationTestResult> =>
  text === undefined
    ? Option.none()
    : Result.getSuccess(S.decodeResult(S.fromJsonString(Report.MutationTestResult))(text))

const parseSarif = (text: string | undefined): Option.Option<SarifDocument> =>
  text === undefined ? Option.none() : Result.getSuccess(S.decodeResult(S.fromJsonString(SarifDocument))(text))

const parseReproducers = (text: string | undefined): Option.Option<typeof ReproducerList.Type> =>
  text === undefined ? Option.none() : Result.getSuccess(S.decodeResult(S.fromJsonString(ReproducerList))(text))

interface Observed {
  readonly runCompleted: boolean
  readonly report: Report.MutationTestResult | undefined
  readonly sarif: SarifDocument | undefined
  readonly reproducers: typeof ReproducerList.Type | undefined
}

const executeRun = (workspace: Workspace): Effect.Effect<Observed, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(8192)
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(workspace.directory), queue), Engine.nodePlatformLayer),
      Engine.nodePlatformLayer,
    )
    const exit = yield* Engine.mutationTestCell
      .run({
        cliOptions: {
          testRunner: 'command',
          commandRunner: { command: 'true' },
          coverageAnalysis: 'off',
          reporters: ['json', 'sarif'],
          jsonReporter: { fileName: reportFileOf(workspace.directory) },
          thresholds: { high: 60, low: 40, break: 0 },
          checkers: [],
          plugins: [],
          mutate: ['src/**/*.ts'],
          cleanTempDir: 'always',
        },
        targetMutatePatterns: undefined,
      })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const fs = yield* FileSystem.FileSystem
    const readOption = (file: string) => fs.readFileString(file).pipe(Effect.option)
    const reportText = yield* readOption(reportFileOf(workspace.directory))
    const sarifText = yield* readOption(sarifFileOf(workspace.directory))
    const reproducersText = yield* readOption(reproducersFileOf(workspace.directory))
    return {
      runCompleted: Exit.isSuccess(exit),
      report: Option.getOrUndefined(Option.flatMap(reportText, parseReport)),
      sarif: Option.getOrUndefined(Option.flatMap(sarifText, parseSarif)),
      reproducers: Option.getOrUndefined(Option.flatMap(reproducersText, parseReproducers)),
    }
  })

const runAndClean = (workspace: Workspace): Effect.Effect<Observed, never, never> =>
  executeRun(workspace).pipe(
    Effect.ensuring(removeWorkspace(workspace.directory)),
    Effect.provide(filePorts),
  )

const survivorIdsOf = (report: Report.MutationTestResult): ReadonlyArray<Mutant.MutantId> =>
  Object.values(report.files).flatMap((file) =>
    file.mutants
      .filter((mutant) => mutant.status === 'Survived' || mutant.status === 'NoCoverage')
      .flatMap((mutant) => Option.toArray(S.decodeOption(Mutant.MutantId)(mutant.id)))
  )

const mutantsOf = (report: Report.MutationTestResult): ReadonlyArray<Report.MutantResult> =>
  Object.values(report.files).flatMap((file) => [...file.mutants])

interface AnnotateProject {
  readonly root: string
}

const prepareAnnotateProject = (): Effect.Effect<
  AnnotateProject,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-annotate-' }))
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@systemfsoftware'), { recursive: true })
    yield* fs.symlink(PACKAGE_ROOT, path.join(root, 'node_modules', '@systemfsoftware', 'stryker-js'))
    yield* fs.makeDirectory(path.join(root, 'src'))
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), CONSUMER_CONFIG)
    yield* fs.writeFileString(path.join(root, ANNOTATE_TARGET_FILE), 'export const sum = (a, b) => a + b\n')
    const reportPath = path.join(root, ANNOTATE_REPORT_FILE)
    yield* fs.makeDirectory(path.dirname(reportPath), { recursive: true })
    yield* fs.writeFileString(reportPath, ANNOTATE_REPORT_JSON)
    yield* fs.writeFileString(path.join(root, ANNOTATE_BASELINE_FILE), ANNOTATE_BASELINE_JSON)
    return { root }
  }).pipe(Effect.orDie)

interface AnnotateRun {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const runAnnotate = (
  root: string,
  args: ReadonlyArray<string>,
): Effect.Effect<AnnotateRun, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'annotate', ...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'human', NO_COLOR: '1' },
          extendEnv: true,
        }),
      )
      const printedOut = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const printedErr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      const [out, err] = yield* Effect.all([Fiber.join(printedOut), Fiber.join(printedErr)])
      return { exitCode: Number(exitCode), stdout: out, stderr: err }
    }),
  ).pipe(Effect.orDie)

const annotationLinesOf = (stdout: string): ReadonlyArray<string> =>
  Arr.filter(stdout.split('\n'), (line) => line.startsWith('::'))

Feature('Survivors reaching code scanning, annotations, and reproducers', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the run drives the real engine in process and writes the report, the SARIF log, and the sidecar')
  .body(({ scenario }) => {
    scenario(
      'A run with survivors writes a SARIF log and a reproducer for every mutant',
      Gherkin.Do.pipe(
        Given('a workspace whose test command kills nothing')(
          'workspace',
          () => writeWorkspace().pipe(Effect.provide(filePorts)),
        ),
        When('a mutation run executes with the json and sarif reporters')(
          'observation',
          (s) => runAndClean(s.workspace),
        ),
        Then('the SARIF results carry the surfaced survivors and every mutant has a reproducer')((s, expect) => {
          const report = s.observation.report
          const sarif = s.observation.sarif
          const reproducers = s.observation.reproducers
          const run = sarif === undefined ? undefined : Option.getOrUndefined(Arr.head(sarif.runs))
          const survivors = report === undefined ? [] : survivorIdsOf(report)
          const mutants = report === undefined ? [] : mutantsOf(report)
          const fingerprints = (run?.results ?? []).map((result) => result.partialFingerprints.primaryLocationLineHash)
          const ruleIds = (run?.tool.driver.rules ?? []).map((rule) => rule.id)
          return expect({
            runCompleted: s.observation.runCompleted,
            sarifVersion: sarif?.version,
            sarifSchema: sarif?.$schema,
            toolName: run?.tool.driver.name,
            hasSarifResults: fingerprints.length > 0,
            fingerprintsAreSurvivors: fingerprints.every((id) => survivors.some((survivor) => survivor === id)),
            fingerprintsAreUnique: new Set(fingerprints).size === fingerprints.length,
            everyRuleIdIsInTheDriver: (run?.results ?? []).every(
              (result) => ruleIds[result.ruleIndex] === result.ruleId,
            ),
            sarifLocationsAreRelative: (run?.results ?? []).every((result) =>
              result.locations.every((location) => !location.physicalLocation.artifactLocation.uri.startsWith('/'))
            ),
            reproducerCount: reproducers?.length,
            reproducerIdsMatchTheReport: JSON.stringify(
              Arr.map(reproducers ?? [], (reproducer) => reproducer.id).toSorted(),
            ) ===
              JSON.stringify(mutants.map((mutant) => mutant.id).toSorted()),
            everyReproducerCarriesADiff: (reproducers ?? []).every((reproducer) => reproducer.diff.includes('@@')),
            everyReproducerNamesItsId: (reproducers ?? []).every((reproducer) =>
              reproducer.command === `stryker run --mutant ${reproducer.id}`
            ),
          }).toEqual({
            runCompleted: true,
            sarifVersion: '2.1.0',
            sarifSchema: 'https://json.schemastore.org/sarif-2.1.0.json',
            toolName: 'StrykerJS',
            hasSarifResults: true,
            fingerprintsAreSurvivors: true,
            fingerprintsAreUnique: true,
            everyRuleIdIsInTheDriver: true,
            sarifLocationsAreRelative: true,
            reproducerCount: mutants.length,
            reproducerIdsMatchTheReport: true,
            everyReproducerCarriesADiff: true,
            everyReproducerNamesItsId: true,
          })
        }),
      ),
    )

    scenario(
      'The annotate command prints escaped workflow commands for the surfaced survivors only',
      Gherkin.Do.pipe(
        Given('a project whose report holds two survivors on one line and a killed mutant beside them')(
          'project',
          () => prepareAnnotateProject(),
        ),
        When('stryker annotates without a baseline')('annotated', (s) => runAnnotate(s.project.root, [])),
        When('stryker annotates with every surfaced survivor in the baseline')(
          'gated',
          (s) => runAnnotate(s.project.root, ['--baseline', ANNOTATE_BASELINE_FILE]),
        ),
        Then('only the capped survivor is annotated, with its file name escaped as a workflow property')(
          (s, expect) => {
            const lines = annotationLinesOf(s.annotated.stdout)
            const annotation = lines[0]
            return expect({
              exitCode: s.annotated.exitCode,
              annotationLines: lines.length,
              namesTheEscapedTargetFile: annotation?.includes(`file=src/odd%2Cname%3Aone.js`),
              namesTheKilledMutantsLine: annotation?.includes('line=2'),
              namesTheSurvivorsLine: annotation?.includes('line=1'),
              carriesTheMutatorTitle: annotation?.includes('title=ArithmeticOperator'),
              carriesTheRegionStart: annotation?.includes('line=1,endLine=1,col=26'),
              carriesTheRegionEnd: annotation?.includes('endColumn=27'),
              everyLineIsASingleLine: Arr.every(lines, (line) => !line.includes('\n')),
              baselineExitCode: s.gated.exitCode,
              baselineNamesNoSurvivor: annotationLinesOf(s.gated.stdout).length,
              baselineNotesTheSurvivorCount: s.gated.stdout.includes(
                'no survivors to annotate (1 survivors in the report)',
              ),
            }).toEqual({
              exitCode: 0,
              annotationLines: 1,
              namesTheEscapedTargetFile: true,
              namesTheKilledMutantsLine: false,
              namesTheSurvivorsLine: true,
              carriesTheMutatorTitle: true,
              carriesTheRegionStart: true,
              carriesTheRegionEnd: true,
              everyLineIsASingleLine: true,
              baselineExitCode: 0,
              baselineNamesNoSurvivor: 0,
              baselineNotesTheSurvivorCount: true,
            })
          },
        ),
      ),
    )
  })
