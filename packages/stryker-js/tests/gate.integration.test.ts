import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const REPORT_FILE = 'reports/mutation/mutation.json'
const COMMITTED_BASELINE = 'baseline.json'
const WRITTEN_BASELINE = 'written-baseline.json'

const COMMITTED_A = '1a1a1a1a1a1a1a1a'
const COMMITTED_B = '2b2b2b2b2b2b2b2b'
const COMMITTED_C = '3c3c3c3c3c3c3c3c'
const NEW_SURVIVOR = '4d4d4d4d4d4d4d4d'
const PENDING_ONE = '5e5e5e5e5e5e5e5e'
const PENDING_TWO = '6f6f6f6f6f6f6f6f'

const CONSUMER_PACKAGE = '{ "name": "gate-consumer", "type": "module", "private": true }\n'

const CONFIG = `export default {
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

const REPORT_JSON = `{
  "files": {
    "src/sum.js": {
      "source": "export const sum = (a, b) => a + b\\n",
      "mutants": [
${
  [
    mutantLine(COMMITTED_A, 1, 'Survived'),
    mutantLine(COMMITTED_B, 2, 'Survived'),
    mutantLine(COMMITTED_C, 3, 'NoCoverage'),
    mutantLine(NEW_SURVIVOR, 4, 'Survived'),
    mutantLine(PENDING_ONE, 5, 'Pending'),
    mutantLine(PENDING_TWO, 6, 'Pending'),
  ].join(',\n')
}
      ]
    }
  }
}
`

const baselineJson = (survivorIds: ReadonlyArray<string>): string =>
  `{ "schemaVersion": 1, "survivors": [${survivorIds.map((id) => `"${id}"`).join(', ')}] }\n`

const decodeBaselineFile = S.decodeUnknownEffect(S.fromJsonString(S.Struct({ survivors: S.Array(S.String) })))

interface GateRun {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

interface GateProject {
  readonly root: string
  readonly reportPath: string
}

const prepareProject = (
  baseline: string | null,
): Effect.Effect<GateProject, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-gate-' }))
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@systemfsoftware'), { recursive: true })
    yield* fs.symlink(PACKAGE_ROOT, path.join(root, 'node_modules', '@systemfsoftware', 'stryker-js'))
    yield* fs.makeDirectory(path.join(root, 'src'))
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), CONFIG)
    yield* fs.writeFileString(path.join(root, 'src', 'sum.js'), 'export const sum = (a, b) => a + b\n')
    const reportPath = path.join(root, REPORT_FILE)
    yield* fs.makeDirectory(path.dirname(reportPath), { recursive: true })
    yield* fs.writeFileString(reportPath, REPORT_JSON)
    yield* Effect.when(
      fs.writeFileString(path.join(root, COMMITTED_BASELINE), baseline ?? ''),
      Effect.succeed(baseline !== null),
    )
    return { root, reportPath }
  }).pipe(Effect.orDie)

const runGate = (
  root: string,
  mode: 'human' | 'machine',
  args: ReadonlyArray<string>,
): Effect.Effect<GateRun, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'gate', ...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: mode, NO_COLOR: '1' },
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

const readBaselineSurvivors = (
  reportPath: string,
): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(
      path.join(path.dirname(path.dirname(path.dirname(reportPath))), WRITTEN_BASELINE),
    )
    return (yield* decodeBaselineFile(text)).survivors
  }).pipe(Effect.orDie)

const namesOnlyTheNewSurvivor = (output: string): boolean =>
  output.includes(NEW_SURVIVOR) &&
  !output.includes(COMMITTED_A) &&
  !output.includes(COMMITTED_B) &&
  !output.includes(COMMITTED_C)

Feature('Gating a pull request on survivors the committed baseline has never seen', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary reads the finished report and the committed baseline in a real Node process')
  .body(({ scenario }) => {
    scenario(
      'A new survivor beside three committed ones exits 1 and names only the new mutant',
      Gherkin.Do.pipe(
        Given('a project whose baseline lists the three already-accepted survivors')(
          'project',
          () => prepareProject(baselineJson([COMMITTED_A, COMMITTED_B, COMMITTED_C])),
        ),
        When('stryker gates against that baseline')(
          'ran',
          (s) => runGate(s.project.root, 'human', ['--baseline', COMMITTED_BASELINE]),
        ),
        Then('the process exits 1 and stderr names only the new survivor once')((s, expect) =>
          expect({
            exitCode: s.ran.exitCode,
            namesOnlyTheNewSurvivor: namesOnlyTheNewSurvivor(s.ran.stderr),
            newIdAppearances: s.ran.stderr.split(NEW_SURVIVOR).length - 1,
          }).toStrictEqual({ exitCode: 1, namesOnlyTheNewSurvivor: true, newIdAppearances: 1 })
        ),
      ),
    )

    scenario(
      'A baseline that already lists every survivor exits 0 and still reports the unchecked tally',
      Gherkin.Do.pipe(
        Given('a project whose baseline lists all four survivors and whose report leaves two mutants pending')(
          'project',
          () => prepareProject(baselineJson([COMMITTED_A, COMMITTED_B, COMMITTED_C, NEW_SURVIVOR])),
        ),
        When('stryker gates against that baseline')(
          'ran',
          (s) => runGate(s.project.root, 'human', ['--baseline', COMMITTED_BASELINE]),
        ),
        Then('the process exits 0 and the unchecked tally is reported')((s, expect) =>
          expect({
            exitCode: s.ran.exitCode,
            reportsUnchecked: /2 mutant\(s\) unchecked/.test(s.ran.stderr),
          }).toStrictEqual({ exitCode: 0, reportsUnchecked: true })
        ),
      ),
    )

    scenario(
      'No usable baseline without --update-baseline is an input failure, not a verdict',
      Gherkin.Do.pipe(
        Given('a project with no committed baseline file')('project', () => prepareProject(null)),
        When('stryker gates without --update-baseline')(
          'ran',
          (s) => runGate(s.project.root, 'human', ['--baseline', COMMITTED_BASELINE]),
        ),
        Then('the process exits with the input failure code and stderr says how to write a baseline')((
          s,
          expect,
        ) =>
          expect({
            exitCode: s.ran.exitCode,
            namesTheRemediation: s.ran.stderr.includes('--update-baseline'),
          }).toStrictEqual({ exitCode: 2, namesTheRemediation: true })
        ),
      ),
    )

    scenario(
      '--update-baseline writes exactly the survivor ids of this run',
      Gherkin.Do.pipe(
        Given('a project with no committed baseline file')('project', () => prepareProject(null)),
        When('stryker gates with --update-baseline')(
          'ran',
          (s) => runGate(s.project.root, 'human', ['--baseline', WRITTEN_BASELINE, '--update-baseline']),
        ),
        When('the written baseline is read back')('written', (s) => readBaselineSurvivors(s.project.reportPath)),
        Then('the process exits 0 and the baseline holds this run’s survivors')((s, expect) =>
          expect({ exitCode: s.ran.exitCode, written: [...s.written] }).toStrictEqual({
            exitCode: 0,
            written: [COMMITTED_A, COMMITTED_B, COMMITTED_C, NEW_SURVIVOR],
          })
        ),
      ),
    )
  })
