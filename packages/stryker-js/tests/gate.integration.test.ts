import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const REPORT_FILE = 'reports/mutation/mutation.json'
const COMMITTED_BASELINE = 'baseline.json'
const WRITTEN_BASELINE = 'written-baseline.json'
const COMMITTED_BUDGET_BASELINE = 'budget-baseline.json'
const WRITTEN_BUDGET_BASELINE = 'written-budget-baseline.json'

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
  "schemaVersion": "1.0",
  "thresholds": { "high": 80, "low": 60, "break": null },
  "budget": { "predictedSeconds": 1, "actualSeconds": 4 },
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

const budgetBaselineJson = (actualSeconds: number): string =>
  `{ "schemaVersion": 1, "actualSeconds": ${actualSeconds} }\n`

const decodeBaselineFile = S.decodeUnknownEffect(S.fromJsonString(S.Struct({ survivors: S.Array(S.String) })))

const decodeBudgetBaselineFile = S.decodeUnknownEffect(S.fromJsonString(S.Struct({ actualSeconds: S.Finite })))

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
  budgetBaseline: string | null = null,
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
    yield* Effect.when(
      fs.writeFileString(path.join(root, COMMITTED_BUDGET_BASELINE), budgetBaseline ?? ''),
      Effect.succeed(budgetBaseline !== null),
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

const readWrittenBudgetBaseline = (
  reportPath: string,
): Effect.Effect<number, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(
      path.join(path.dirname(path.dirname(path.dirname(reportPath))), WRITTEN_BUDGET_BASELINE),
    )
    return (yield* decodeBudgetBaselineFile(text)).actualSeconds
  }).pipe(Effect.orDie)

Feature('Gating a pull request on the committed survivor and time-budget baselines', { timeout: 180_000 })
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

    scenario(
      'A run whose report took longer than the committed budget baseline plus tolerance exits 1 naming both durations',
      Gherkin.Do.pipe(
        Given('a project whose survivors are all committed and whose committed budget baseline is 3 seconds')(
          'project',
          () =>
            prepareProject(baselineJson([COMMITTED_A, COMMITTED_B, COMMITTED_C, NEW_SURVIVOR]), budgetBaselineJson(3)),
        ),
        When('stryker gates against both baselines')(
          'ran',
          (s) =>
            runGate(s.project.root, 'human', [
              '--baseline',
              COMMITTED_BASELINE,
              '--budget-baseline',
              COMMITTED_BUDGET_BASELINE,
            ]),
        ),
        Then('the process exits 1 and stderr names the baseline and the actual seconds')((s, expect) =>
          expect({
            exitCode: s.ran.exitCode,
            namesBaseline: s.ran.stderr.includes('3.00'),
            namesActual: s.ran.stderr.includes('4.00'),
          }).toStrictEqual({ exitCode: 1, namesBaseline: true, namesActual: true })
        ),
      ),
    )

    scenario(
      'A run within the committed budget baseline plus tolerance exits 0',
      Gherkin.Do.pipe(
        Given('a project whose survivors are all committed and whose committed budget baseline is 4 seconds')(
          'project',
          () =>
            prepareProject(baselineJson([COMMITTED_A, COMMITTED_B, COMMITTED_C, NEW_SURVIVOR]), budgetBaselineJson(4)),
        ),
        When('stryker gates against both baselines')(
          'ran',
          (s) =>
            runGate(s.project.root, 'human', [
              '--baseline',
              COMMITTED_BASELINE,
              '--budget-baseline',
              COMMITTED_BUDGET_BASELINE,
            ]),
        ),
        Then('the process exits 0')((s, expect) => expect({ exitCode: s.ran.exitCode }).toStrictEqual({ exitCode: 0 })),
      ),
    )

    scenario(
      '--update-budget-baseline writes the finished run’s actual seconds',
      Gherkin.Do.pipe(
        Given('a project with no committed budget baseline file')(
          'project',
          () => prepareProject(baselineJson([COMMITTED_A, COMMITTED_B, COMMITTED_C, NEW_SURVIVOR]), null),
        ),
        When('stryker gates with --update-budget-baseline')(
          'ran',
          (s) =>
            runGate(s.project.root, 'human', [
              '--baseline',
              WRITTEN_BASELINE,
              '--update-baseline',
              '--budget-baseline',
              WRITTEN_BUDGET_BASELINE,
              '--update-budget-baseline',
            ]),
        ),
        When('the written budget baseline is read back')(
          'written',
          (s) => readWrittenBudgetBaseline(s.project.reportPath),
        ),
        Then('the process exits 0 and the baseline holds this run’s actual seconds')((s, expect) =>
          expect({ exitCode: s.ran.exitCode, written: s.written }).toStrictEqual({ exitCode: 0, written: 4 })
        ),
      ),
    )

    scenario(
      'A budget-only gate without --baseline skips the survivor check and passes within tolerance',
      Gherkin.Do.pipe(
        Given('a project with a committed budget baseline of 4 seconds and no committed survivor baseline')(
          'project',
          () => prepareProject(null, budgetBaselineJson(4)),
        ),
        When('stryker gates with only --budget-baseline')(
          'ran',
          (s) => runGate(s.project.root, 'human', ['--budget-baseline', COMMITTED_BUDGET_BASELINE]),
        ),
        Then('the process exits 0')((s, expect) => expect({ exitCode: s.ran.exitCode }).toStrictEqual({ exitCode: 0 })),
      ),
    )
  })
