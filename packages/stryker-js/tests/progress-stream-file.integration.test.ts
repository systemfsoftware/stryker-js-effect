import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const CONFIGURED_STREAM = 'out/stream.jsonl'

const DEFAULT_STREAM = 'reports/mutation-stream.jsonl'

const JSON_REPORT = 'out/report.json'

const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  coverageAnalysis: 'off',
  mutate: ['src/**/*.ts'],
  checkers: [],
  reporters: ['json'],
  concurrency: 1,
  incremental: true,
  ignorePatterns: [],
  incrementalFile: 'out/incremental.json',
  progressStreamFile: '${CONFIGURED_STREAM}',
  jsonReporter: { fileName: '${JSON_REPORT}' },
}
`

const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'

const requireBuiltBinary = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const binaryPresent = yield* fs.exists(STRYKER_BIN)
  yield* Effect.when(
    Effect.die(new Error('dist/main.mjs is missing — build the package first')),
    Effect.succeed(!binaryPresent),
  )
}).pipe(Effect.orDie)

const prepareProject = (): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    yield* requireBuiltBinary
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-stream-file-' }))
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.writeFileString(path.join(root, 'package.json'), '{ "name": "stream-consumer", "type": "module" }\n')
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), CONFIG)
    yield* fs.writeFileString(path.join(root, 'src', 'math.ts'), SOURCE)
    return root
  }).pipe(Effect.orDie)

const runStryker = (cwd: string): Effect.Effect<number, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'run', '--json'], {
          cwd,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { NO_COLOR: '1' },
          extendEnv: true,
        }),
      )
      yield* handle.stdout.pipe(Stream.runDrain, Effect.forkScoped)
      yield* handle.stderr.pipe(Stream.runDrain, Effect.forkScoped)
      return Number(yield* handle.exitCode)
    }),
  ).pipe(Effect.orDie)

const decodeReport = S.decodeOption(S.fromJsonString(Report.MutationTestResult))

const reuseOf = (stream: string): RunEvent.ReuseReported | undefined =>
  stream.split('\n')
    .flatMap((line) => Option.toArray(S.decodeOption(RunEvent.RunEventWireLine)(line.trim())))
    .find((event) => S.is(RunEvent.ReuseReported)(event))

const readOptional = (file: string): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(file).pipe(Effect.option))

interface SecondRun {
  readonly exitCodes: readonly number[]
  readonly reuse: RunEvent.ReuseReported | undefined
  readonly reportedMutants: number
  readonly defaultStreamWritten: boolean
}

const runTwice = Effect.scoped(
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* prepareProject()
    const first = yield* runStryker(root)
    const second = yield* runStryker(root)
    const stream = yield* readOptional(path.join(root, CONFIGURED_STREAM))
    const report = yield* readOptional(path.join(root, JSON_REPORT))
    const defaultStreamWritten = yield* fs.exists(path.join(root, DEFAULT_STREAM)).pipe(Effect.orDie)
    const run: SecondRun = {
      exitCodes: [first, second],
      reuse: Option.getOrUndefined(Option.map(stream, reuseOf)),
      reportedMutants: Option.match(Option.flatMap(report, decodeReport), {
        onNone: () => 0,
        onSome: (decoded) => Object.values(decoded.files).reduce((total, file) => total + file.mutants.length, 0),
      }),
      defaultStreamWritten,
    }
    return run
  }),
)

Feature('A configured progress stream file stays out of the next run', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs a real project on the host filesystem')
  .body(({ scenario }) => {
    scenario(
      'An unchanged project whose config names its stream file re-runs no mutant the second time',
      Gherkin.Do.pipe(
        Given(
          'a project with no ignore patterns whose config names progressStreamFile, run twice with nothing changed',
        )('run', () => runTwice),
        Then(
          'the second run writes its stream at the configured path, reuses every reported mutant and writes no default stream',
        )((s, expect) =>
          expect({
            exitCodes: s.run.exitCodes,
            reuseReported: s.run.reuse !== undefined,
            ran: s.run.reuse?.ran,
            reused: s.run.reuse?.reused,
            mutantsReported: s.run.reportedMutants > 0,
            defaultStreamWritten: s.run.defaultStreamWritten,
          }).toEqual({
            exitCodes: [0, 0],
            reuseReported: true,
            ran: 0,
            reused: s.run.reportedMutants,
            mutantsReported: true,
            defaultStreamWritten: false,
          })
        ),
      ),
    )
  })
