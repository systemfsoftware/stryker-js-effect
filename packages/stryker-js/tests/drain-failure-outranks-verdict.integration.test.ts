import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)
const REFUSING_REPORTER_PLUGIN = new URL('./__fixtures__/refusing-reporter/index.mjs', import.meta.url).href

const SOURCE = `export const add = (a, b) => a + b
export const isPositive = (n) => n > 0
`

const CONSUMER_PACKAGE = '{ "name": "drain-failure-consumer", "type": "module", "private": true }\n'

const BREAK_THRESHOLD = 100

const configReportingTo = (reporters: ReadonlyArray<string>) =>
  `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  concurrency: 1,
  plugins: [${JSON.stringify(REFUSING_REPORTER_PLUGIN)}],
  reporters: ${JSON.stringify(reporters)},
  thresholds: { high: 80, low: 60, break: ${String(BREAK_THRESHOLD)} },
}
`

const decodeVerdict = S.decodeUnknownOption(S.fromJsonString(RunEvent.VerdictReached))

interface RunOutcome {
  readonly exitCode: number
  readonly verdict: Option.Option<RunEvent.VerdictReached>
}

const prepareProject = (
  reporters: ReadonlyArray<string>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-drain-failure-' }))
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@systemfsoftware'), { recursive: true })
    yield* fs.symlink(PACKAGE_ROOT, path.join(root, 'node_modules', '@systemfsoftware', 'stryker-js'))
    yield* fs.makeDirectory(path.join(root, 'src'))
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    yield* fs.writeFileString(path.join(root, 'src', 'add.js'), SOURCE)
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), configReportingTo(reporters))
    return root
  }).pipe(Effect.orDie)

const runStryker = (root: string): Effect.Effect<RunOutcome, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'run'], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'machine', NO_COLOR: '1' },
          extendEnv: true,
        }),
      )
      const printed = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      const output = yield* Fiber.join(printed)
      const records = output.trim().split('\n')
      return { exitCode: Number(exitCode), verdict: Option.firstSomeOf(records.map((record) => decodeVerdict(record))) }
    }),
  ).pipe(Effect.orDie)

const scoreUnderTheBreakThreshold = (verdict: Option.Option<RunEvent.VerdictReached>): boolean =>
  Option.exists(verdict, (reached) => reached.score !== null && reached.score < BREAK_THRESHOLD)

Feature('Failing the build when a reporter cannot take the finished report', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs a consumer project and loads a reporter plugin from disk')
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'A project scored under its break threshold, reporting <reporting>, exits <exitCode> for <reason>',
      [
        {
          reporting: 'also to a reporter that refuses the finished report',
          reporters: ['json', 'refusing'],
          exitCode: 3,
          reason: 'the reporter failure',
        },
        { reporting: 'only to the JSON reporter', reporters: ['json'], exitCode: 1, reason: 'its score' },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a project whose tests kill no mutant, with a break threshold of 100, reporting ${row.reporting}`)(
            'root',
            () => prepareProject(row.reporters),
          ),
          When('stryker runs it')('ran', (s) => runStryker(s.root)),
          Then(`the verdict scores the run under the threshold and the process exits ${String(row.exitCode)}`)((
            s,
            expect,
          ) =>
            expect({
              scoreUnderTheBreakThreshold: scoreUnderTheBreakThreshold(s.ran.verdict),
              exitCode: s.ran.exitCode,
            }).toEqual({ scoreUnderTheBreakThreshold: true, exitCode: row.exitCode })
          ),
        ),
    )
  })
