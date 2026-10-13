import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
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

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const CONFIGURED_STREAM = 'out/stream.jsonl'

const NESTED_STREAM = 'out/nested/stream.jsonl'

const STREAM_DIRECTORY = 'out/stream'

const DRAIN_FILE_FAILED = 'stryker.output.drain_file_failed'

const DEFAULT_STREAM = 'reports/mutation-stream.jsonl'

const JSON_REPORT = 'out/report.json'

const CONFIG_FILE = 'stryker.config.mjs'

const settingsOf = (streamFile: string) =>
  `{
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
  progressStreamFile: '${streamFile}',
  jsonReporter: { fileName: '${JSON_REPORT}' },
}`

const configNaming = (streamFile: string) => `export default ${settingsOf(streamFile)}\n`

const FIRST_ANSWER = 'out/first.jsonl'

const FACTORY_CONFIG = `let calls = 0
export default () => {
  calls += 1
  return ${settingsOf('__STREAM__')}
}
`.replace("'__STREAM__'", `calls === 1 ? '${FIRST_ANSWER}' : 'out/later.jsonl'`)

const THROWING_CONFIG = "throw new Error('the config cannot be loaded')\n"

const INVALID_STREAM_CONFIG = configNaming('__STREAM__').replace("'__STREAM__'", 'null')

const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'

const RUN = ['run', '--json']

const HELP = ['--help', '--json']

const requireBuiltBinary = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const binaryPresent = yield* fs.exists(STRYKER_BIN)
  yield* Effect.when(
    Effect.die(new Error('dist/main.mjs is missing — build the package first')),
    Effect.succeed(!binaryPresent),
  )
}).pipe(Effect.orDie)

const prepareProject = (
  config: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    yield* requireBuiltBinary
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-stream-file-' }))
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.writeFileString(path.join(root, 'package.json'), '{ "name": "stream-consumer", "type": "module" }\n')
    yield* fs.writeFileString(path.join(root, CONFIG_FILE), config)
    yield* fs.writeFileString(path.join(root, 'src', 'math.ts'), SOURCE)
    return root
  }).pipe(Effect.orDie)

interface Invocation {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly defaultStreamPresent: boolean
}

const invoke = (
  root: string,
  args: ReadonlyArray<string>,
): Effect.Effect<Invocation, never, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, ...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { NO_COLOR: '1' },
          extendEnv: true,
        }),
      )
      const stdout = yield* handle.stdout.pipe(Stream.decodeText, Stream.mkString, Effect.forkScoped)
      const stderr = yield* handle.stderr.pipe(Stream.decodeText, Stream.mkString, Effect.forkScoped)
      const exitCode = Number(yield* handle.exitCode)
      const printed = yield* Fiber.join(stdout)
      const logged = yield* Fiber.join(stderr)
      const defaultStreamPresent = yield* fs.exists(path.join(root, DEFAULT_STREAM))
      const invocation: Invocation = { exitCode, stdout: printed, stderr: logged, defaultStreamPresent }
      return invocation
    }),
  ).pipe(Effect.orDie)

const decodeReport = S.decodeOption(S.fromJsonString(Report.MutationTestResult))

const eventsOf = (text: string): ReadonlyArray<RunEvent.RunEvent> =>
  text.split('\n').flatMap((line) => Option.toArray(S.decodeOption(RunEvent.RunEventWireLine)(line.trim())))

const readOptional = (file: string): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(file).pipe(Effect.option))

interface LeftBehind {
  readonly reuse: RunEvent.ReuseReported | undefined
  readonly reportedMutants: number
}

const leftBehind = (
  root: string,
  streamFile: string,
): Effect.Effect<LeftBehind, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const stream = yield* readOptional(path.join(root, streamFile))
    const report = yield* readOptional(path.join(root, JSON_REPORT))
    const left: LeftBehind = {
      reuse: Option.getOrUndefined(
        Option.map(stream, (text) => eventsOf(text).find((event) => S.is(RunEvent.ReuseReported)(event))),
      ),
      reportedMutants: Option.match(Option.flatMap(report, decodeReport), {
        onNone: () => 0,
        onSome: (decoded) => Object.values(decoded.files).reduce((total, file) => total + file.mutants.length, 0),
      }),
    }
    return left
  })

const reusedEveryMutant = (left: LeftBehind) => ({
  ran: left.reuse?.ran,
  reusedEveryReportedMutant: left.reportedMutants > 0 && left.reuse?.reused === left.reportedMutants,
})

const EVERY_MUTANT_REUSED = { ran: 0, reusedEveryReportedMutant: true }

Feature('A stream file Stryker writes stays out of the next run', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs a real project on the host filesystem')
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'An unchanged project whose config names its stream file as <spelling> re-runs no mutant the second time',
      [
        { spelling: 'a plain relative path', streamFile: CONFIGURED_STREAM, streamAt: CONFIGURED_STREAM },
        { spelling: 'a ./-prefixed path', streamFile: `./${CONFIGURED_STREAM}`, streamAt: CONFIGURED_STREAM },
        { spelling: 'a path with a doubled slash', streamFile: 'out//stream.jsonl', streamAt: CONFIGURED_STREAM },
        { spelling: 'a path with a trailing slash', streamFile: `${CONFIGURED_STREAM}/`, streamAt: CONFIGURED_STREAM },
        { spelling: 'a ./-prefixed nested path', streamFile: `./${NESTED_STREAM}`, streamAt: NESTED_STREAM },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project with no ignore patterns whose config names its stream file')(
            'project',
            () => prepareProject(configNaming(row.streamFile)),
          ),
          When('the project is run')('first', (s) => invoke(s.project, RUN)),
          When('the project is run again with nothing changed')('second', (s) => invoke(s.project, RUN)),
          When('the files the second run left are read')('left', (s) => leftBehind(s.project, row.streamAt)),
          Then('the stream is at the configured path, every reported mutant is reused, and no default stream exists')(
            (s, expect) =>
              expect({
                exitCodes: [s.first.exitCode, s.second.exitCode],
                ...reusedEveryMutant(s.left),
                defaultStreamPresent: s.second.defaultStreamPresent,
              }).toEqual({ exitCodes: [0, 0], ...EVERY_MUTANT_REUSED, defaultStreamPresent: false }),
          ),
        ),
    )

    scenario(
      'A run after another stryker command in the same project still re-runs no mutant',
      Gherkin.Do.pipe(
        Given('a project with no ignore patterns whose config names its stream file')(
          'project',
          () => prepareProject(configNaming(CONFIGURED_STREAM)),
        ),
        When('the project is run')('first', (s) => invoke(s.project, RUN)),
        When('stryker is asked for help in the project')('help', (s) => invoke(s.project, HELP)),
        When('the project is run again with nothing changed')('second', (s) => invoke(s.project, RUN)),
        When('the files the last run left are read')('left', (s) => leftBehind(s.project, CONFIGURED_STREAM)),
        Then('the help left a stream at the default path, and the last run reuses every reported mutant')(
          (s, expect) =>
            expect({
              exitCodes: [s.first.exitCode, s.help.exitCode, s.second.exitCode],
              defaultStreamPresent: [
                s.first.defaultStreamPresent,
                s.help.defaultStreamPresent,
                s.second.defaultStreamPresent,
              ],
              ...reusedEveryMutant(s.left),
            }).toEqual({
              exitCodes: [0, 0, 0],
              defaultStreamPresent: [false, true, true],
              ...EVERY_MUTANT_REUSED,
            }),
        ),
      ),
    )

    scenario(
      'A config whose stream file is empty streams to the default path and re-runs no mutant the second time',
      Gherkin.Do.pipe(
        Given('a project with no ignore patterns whose config names an empty stream file')(
          'project',
          () => prepareProject(configNaming('')),
        ),
        When('the project is run')('first', (s) => invoke(s.project, RUN)),
        When('the project is run again with nothing changed')('second', (s) => invoke(s.project, RUN)),
        When('the files the second run left are read')('left', (s) => leftBehind(s.project, DEFAULT_STREAM)),
        Then('the stream is at the default path and every reported mutant is reused')((s, expect) =>
          expect({
            exitCodes: [s.first.exitCode, s.second.exitCode],
            streamedOnStdout: eventsOf(s.second.stdout).length > 0,
            ...reusedEveryMutant(s.left),
          }).toEqual({ exitCodes: [0, 0], streamedOnStdout: true, ...EVERY_MUTANT_REUSED })
        ),
      ),
    )

    scenario(
      'The --progressStreamFile flag wins over the stream file the config names',
      Gherkin.Do.pipe(
        Given('a project with no ignore patterns whose config names its stream file')(
          'project',
          () => prepareProject(configNaming(CONFIGURED_STREAM)),
        ),
        When('the project is run naming another stream file on the command line')(
          'first',
          (s) => invoke(s.project, [...RUN, '--progressStreamFile', 'out/flag.jsonl']),
        ),
        When('the same run is repeated with nothing changed')(
          'second',
          (s) => invoke(s.project, [...RUN, '--progressStreamFile', 'out/flag.jsonl']),
        ),
        When('the files the second run left are read')('left', (s) =>
          Effect.all({
            flagged: leftBehind(s.project, 'out/flag.jsonl'),
            configured: Effect.flatMap(Path.Path, (path) => readOptional(path.join(s.project, CONFIGURED_STREAM))),
          })),
        Then('the stream is at the flag path, not the configured one, and every reported mutant is reused')(
          (s, expect) =>
            expect({
              exitCodes: [s.first.exitCode, s.second.exitCode],
              configuredStreamWritten: Option.isSome(s.left.configured),
              ...reusedEveryMutant(s.left.flagged),
            }).toEqual({ exitCodes: [0, 0], configuredStreamWritten: false, ...EVERY_MUTANT_REUSED }),
        ),
      ),
    )

    scenario(
      'A config that names a different stream file each time it is asked still re-runs no mutant the second time',
      Gherkin.Do.pipe(
        Given('a project with no ignore patterns whose config function answers one stream file, then another')(
          'project',
          () => prepareProject(FACTORY_CONFIG),
        ),
        When('the project is run')('first', (s) => invoke(s.project, RUN)),
        When('the project is run again with nothing changed')('second', (s) => invoke(s.project, RUN)),
        When('the files the second run left are read')('left', (s) => leftBehind(s.project, FIRST_ANSWER)),
        Then('the stream is at the first answer and every reported mutant is reused')((s, expect) =>
          expect({
            exitCodes: [s.first.exitCode, s.second.exitCode],
            ...reusedEveryMutant(s.left),
          }).toEqual({ exitCodes: [0, 0], ...EVERY_MUTANT_REUSED })
        ),
      ),
    )

    scenarioOutline(
      'A config that <failure> is refused as before and the stream still opens at the default path',
      [
        { failure: 'throws while it is loaded', config: THROWING_CONFIG, named: CONFIG_FILE },
        { failure: 'names an invalid stream file', config: INVALID_STREAM_CONFIG, named: 'progressStreamFile' },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project whose config is refused')('project', () => prepareProject(row.config)),
          When('the project is run')('run', (s) => invoke(s.project, RUN)),
          Then('the run exits with a config error naming what is wrong, and the stream is at the default path')(
            (s, expect) => {
              const failure = eventsOf(s.run.stdout).find((event) => S.is(RunEvent.RunFailed)(event))
              return expect({
                exitCode: s.run.exitCode,
                namesTheCause: failure?.error.includes(row.named),
                defaultStreamPresent: s.run.defaultStreamPresent,
              }).toEqual({ exitCode: 2, namesTheCause: true, defaultStreamPresent: true })
            },
          ),
        ),
    )

    scenarioOutline(
      'A stream file that <failure> is reported, and the run still streams its records on stdout',
      [
        { failure: 'cannot be opened', streamDirectory: true, args: RUN },
        { failure: 'refuses every write', streamDirectory: false, args: [...RUN, '--progressStreamFile', '/dev/full'] },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project whose stream file is an existing directory, or is named by the flag as /dev/full')(
            'project',
            () =>
              Effect.gen(function*() {
                const fs = yield* FileSystem.FileSystem
                const path = yield* Path.Path
                const root = yield* prepareProject(configNaming(STREAM_DIRECTORY))
                yield* Effect.when(
                  fs.makeDirectory(path.join(root, STREAM_DIRECTORY), { recursive: true }).pipe(Effect.orDie),
                  Effect.succeed(row.streamDirectory),
                )
                return root
              }),
          ),
          When('the project is run')('run', (s) => invoke(s.project, row.args)),
          Then('the run succeeds, stdout carries its mutants and its verdict, and stderr names the file failure')(
            (s, expect) => {
              const events = eventsOf(s.run.stdout)
              return expect({
                exitCode: s.run.exitCode,
                mutantsTested: events.some((event) => S.is(RunEvent.RunMutantTested)(event)),
                endsWithVerdict: S.is(RunEvent.VerdictReached)(events.at(-1)),
                namesTheFailure: s.run.stderr.includes(DRAIN_FILE_FAILED),
              }).toEqual({ exitCode: 0, mutantsTested: true, endsWithVerdict: true, namesTheFailure: true })
            },
          ),
        ),
    )
  })
