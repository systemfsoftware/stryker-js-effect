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

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const CONFIGURED_STREAM = 'out/stream.jsonl'

const NESTED_STREAM = 'out/nested/stream.jsonl'

const STREAM_DIRECTORY = 'out/stream'

const DRAIN_FILE_FAILED = 'stryker.output.drain_file_failed'

const DEV_FULL = '/dev/full'

const DEFAULT_STREAM = 'reports/mutation-stream.jsonl'

const JSON_REPORT = 'out/report.json'

const CONFIG_FILE = 'stryker.config.mjs'

const COUNT_TEST_RUN = 'echo run >> "$STRYKER_TEST_RUNS"'

const settingsOf = (streamFile: string, testCommand = COUNT_TEST_RUN) =>
  `{
  testRunner: 'command',
  commandRunner: { command: '${testCommand}' },
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

const ABSOLUTE_STREAM_CONFIG = configNaming('__STREAM__').replace(
  "'__STREAM__'",
  `decodeURIComponent(new URL('${CONFIGURED_STREAM}', import.meta.url).pathname)`,
)

const PROJECT_NOTES = 'notes.txt'

const NOTES = 'a project file the run must not overwrite\n'

const UTF8 = new TextEncoder()

const CASED_DEFAULT_STREAM = 'Reports/Mutation-Stream.jsonl'

const CASED_DEFAULT_CONFIG = `export default ${settingsOf(CONFIGURED_STREAM, `test -f ${CASED_DEFAULT_STREAM}`)}\n`

const LONG_STREAM_RECORD = `${
  JSON.stringify({ _tag: 'stream', schemaVersion: '9.0', runId: 'r', note: 'x'.repeat(5000) })
}\n`

const OVERSIZED_STREAM_RECORD = `${
  JSON.stringify({ _tag: 'stream', schemaVersion: '9.0', runId: 'r', note: 'x'.repeat(1_100_000) })
}\n`

const TORN_RECORD = '{"_tag":"verdict","schemaVersion":"9.0","runId":"06GK'

const LINK_TARGET = 'linked-stream.jsonl'

const caseSwapped = (name: string) =>
  name.split('').map((char) => char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()).join('')

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

const testRunsOf = (root: string) => `${root}.test-runs`

const prepareProject = (
  config: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    yield* requireBuiltBinary
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-stream-file-' }))
    yield* Effect.addFinalizer(() => fs.remove(testRunsOf(root), { force: true }).pipe(Effect.ignore))
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
  readonly testRuns: number
}

const invoke = (
  root: string,
  args: ReadonlyArray<string>,
  mode: 'machine' | 'human' = 'machine',
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
          env: {
            STRYKER_MODE: mode,
            NO_COLOR: '1',
            GITHUB_ACTIONS: '',
            ALLOW_LOCAL_MUTATION: '1',
            STRYKER_TEST_RUNS: testRunsOf(root),
          },
          extendEnv: true,
        }),
      )
      const stdout = yield* handle.stdout.pipe(Stream.decodeText, Stream.mkString, Effect.forkScoped)
      const stderr = yield* handle.stderr.pipe(Stream.decodeText, Stream.mkString, Effect.forkScoped)
      const exitCode = Number(yield* handle.exitCode)
      const printed = yield* Fiber.join(stdout)
      const logged = yield* Fiber.join(stderr)
      const defaultStreamPresent = yield* fs.exists(path.join(root, DEFAULT_STREAM))
      const testRuns = yield* readOptional(testRunsOf(root)).pipe(
        Effect.map((text) => Option.getOrElse(text, () => '').split('\n').filter((line) => line.length > 0).length),
      )
      const invocation: Invocation = { exitCode, stdout: printed, stderr: logged, defaultStreamPresent, testRuns }
      return invocation
    }),
  ).pipe(Effect.orDie)

const eventsOf = (text: string): ReadonlyArray<RunEvent.RunEvent> =>
  text.split('\n').flatMap((line) => Option.toArray(S.decodeOption(RunEvent.RunEventWireLine)(line.trim())))

const readOptional = (file: string): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(file).pipe(Effect.option))

interface LeftBehind {
  readonly reuse: RunEvent.ReuseReported | undefined
}

const leftBehind = (
  root: string,
  streamFile: string,
): Effect.Effect<LeftBehind, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const stream = yield* readOptional(path.join(root, streamFile))
    const left: LeftBehind = {
      reuse: Option.getOrUndefined(
        Option.map(stream, (text) => eventsOf(text).find((event) => S.is(RunEvent.ReuseReported)(event))),
      ),
    }
    return left
  })

const reusedEveryMutant = (left: LeftBehind, before: Invocation, after: Invocation) => ({
  ran: left.reuse?.ran,
  reusedSome: (left.reuse?.reused ?? 0) > 0,
  firstRunTested: before.testRuns > 0,
  testsRunAgain: after.testRuns - before.testRuns,
})

const EVERY_MUTANT_REUSED = { ran: 0, reusedSome: true, firstRunTested: true, testsRunAgain: 0 }

Feature('A stream file Stryker writes stays out of the next run', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs a real project on the host filesystem')
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'An unchanged project whose config names its stream file as <spelling> re-runs no mutant the second time',
      [
        { spelling: 'a plain relative path', config: configNaming(CONFIGURED_STREAM), streamAt: CONFIGURED_STREAM },
        { spelling: 'a ./-prefixed path', config: configNaming(`./${CONFIGURED_STREAM}`), streamAt: CONFIGURED_STREAM },
        {
          spelling: 'a path with a doubled slash',
          config: configNaming('out//stream.jsonl'),
          streamAt: CONFIGURED_STREAM,
        },
        {
          spelling: 'a path with a trailing slash',
          config: configNaming(`${CONFIGURED_STREAM}/`),
          streamAt: CONFIGURED_STREAM,
        },
        { spelling: 'a ./-prefixed nested path', config: configNaming(`./${NESTED_STREAM}`), streamAt: NESTED_STREAM },
        {
          spelling: 'an absolute path inside the project',
          config: ABSOLUTE_STREAM_CONFIG,
          streamAt: CONFIGURED_STREAM,
        },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project with no ignore patterns whose config names its stream file')(
            'project',
            () => prepareProject(row.config),
          ),
          When('the project is run')('first', (s) => invoke(s.project, RUN)),
          When('the project is run again with nothing changed')('second', (s) => invoke(s.project, RUN)),
          When('the files the second run left are read')('left', (s) => leftBehind(s.project, row.streamAt)),
          Then('the stream is at the configured path, the second run runs no test, and no default stream exists')(
            (s, expect) =>
              expect({
                exitCodes: [s.first.exitCode, s.second.exitCode],
                ...reusedEveryMutant(s.left, s.first, s.second),
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
        Then('the help left a stream at the default path, and the last run runs no test')(
          (s, expect) =>
            expect({
              exitCodes: [s.first.exitCode, s.help.exitCode, s.second.exitCode],
              defaultStreamPresent: [
                s.first.defaultStreamPresent,
                s.help.defaultStreamPresent,
                s.second.defaultStreamPresent,
              ],
              ...reusedEveryMutant(s.left, s.first, s.second),
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
        Then('the stream is at the default path and the second run runs no test')((s, expect) =>
          expect({
            exitCodes: [s.first.exitCode, s.second.exitCode],
            streamedOnStdout: eventsOf(s.second.stdout).length > 0,
            ...reusedEveryMutant(s.left, s.first, s.second),
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
        Then('the stream is at the flag path, not the configured one, and the second run runs no test')(
          (s, expect) =>
            expect({
              exitCodes: [s.first.exitCode, s.second.exitCode],
              configuredStreamWritten: Option.isSome(s.left.configured),
              ...reusedEveryMutant(s.left.flagged, s.first, s.second),
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
        Then('the stream is at the first answer and the second run runs no test')((s, expect) =>
          expect({
            exitCodes: [s.first.exitCode, s.second.exitCode],
            ...reusedEveryMutant(s.left, s.first, s.second),
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
      'A stream file that <failure> is reported once, and the run still streams its records on stdout',
      [
        { failure: 'cannot be opened', streamDirectory: true, args: RUN },
        { failure: 'refuses every write', streamDirectory: false, args: [...RUN, '--progressStreamFile', DEV_FULL] },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project whose stream file is an existing directory, or is named by the flag as /dev/full')(
            'project',
            () =>
              Effect.gen(function*() {
                const fs = yield* FileSystem.FileSystem
                const path = yield* Path.Path
                const deviceMissing = yield* fs.exists(DEV_FULL).pipe(
                  Effect.map((present) => !row.streamDirectory && !present),
                  Effect.orDie,
                )
                yield* Effect.when(
                  Effect.die(new Error(`${DEV_FULL} is missing — this row needs the Linux device that refuses writes`)),
                  Effect.succeed(deviceMissing),
                )
                const root = yield* prepareProject(configNaming(STREAM_DIRECTORY))
                yield* Effect.when(
                  fs.makeDirectory(path.join(root, STREAM_DIRECTORY), { recursive: true }).pipe(Effect.orDie),
                  Effect.succeed(row.streamDirectory),
                )
                return root
              }),
          ),
          When('the project is run')('run', (s) => invoke(s.project, row.args)),
          Then('the run succeeds, stdout carries its mutants and its verdict, and stderr names the file failure once')(
            (s, expect) => {
              const events = eventsOf(s.run.stdout)
              return expect({
                exitCode: s.run.exitCode,
                mutantsTested: events.some((event) => S.is(RunEvent.RunMutantTested)(event)),
                endsWithVerdict: S.is(RunEvent.VerdictReached)(events.at(-1)),
                fileFailuresLogged: s.run.stderr.split(DRAIN_FILE_FAILED).length - 1,
              }).toEqual({ exitCode: 0, mutantsTested: true, endsWithVerdict: true, fileFailuresLogged: 1 })
            },
          ),
        ),
    )

    scenarioOutline(
      'A config naming an existing project file <starting> leaves that file intact, and the run still streams on stdout',
      [
        { starting: 'with text', bytes: Array.from(UTF8.encode(NOTES)) },
        { starting: 'with a blank line', bytes: Array.from(UTF8.encode(`\n${NOTES}`)) },
        { starting: 'with an incomplete UTF-8 character', bytes: [0xc3] },
        { starting: 'with a bare stream object', bytes: Array.from(UTF8.encode(`{"_tag":"stream"}\n${NOTES}`)) },
        { starting: 'holding only a bare stream object', bytes: Array.from(UTF8.encode('{"_tag":"stream"}')) },
        {
          starting: 'holding a closed stream object followed by text',
          bytes: Array.from(UTF8.encode('{"_tag":"stream"}oops')),
        },
        {
          starting: 'holding an unclosed stream object followed by text',
          bytes: Array.from(UTF8.encode('{"_tag":"stream": my notes')),
        },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project whose config names one of its own files as the stream file')(
            'project',
            () =>
              Effect.gen(function*() {
                const fs = yield* FileSystem.FileSystem
                const path = yield* Path.Path
                const root = yield* prepareProject(configNaming(PROJECT_NOTES))
                yield* fs.writeFile(path.join(root, PROJECT_NOTES), Uint8Array.from(row.bytes)).pipe(Effect.orDie)
                return root
              }),
          ),
          When('the project is run')('run', (s) => invoke(s.project, RUN)),
          When('the named file is read')(
            'notes',
            (s) =>
              Effect.flatMap(Path.Path, (path) =>
                Effect.flatMap(FileSystem.FileSystem, (fs) =>
                  fs.readFile(path.join(s.project, PROJECT_NOTES)).pipe(Effect.option))),
          ),
          Then('the file keeps its content, stdout carries the verdict, and stderr names the file failure once')(
            (s, expect) => {
              const events = eventsOf(s.run.stdout)
              return expect({
                exitCode: s.run.exitCode,
                notes: Option.getOrUndefined(Option.map(s.notes, (bytes) =>
                  Array.from(bytes))),
                endsWithVerdict: S.is(RunEvent.VerdictReached)(events.at(-1)),
                fileFailuresLogged: s.run.stderr.split(DRAIN_FILE_FAILED).length - 1,
              }).toEqual({ exitCode: 0, notes: row.bytes, endsWithVerdict: true, fileFailuresLogged: 1 })
            },
          ),
        ),
    )

    scenarioOutline(
      'A project file whose path differs from the default stream path only by case stays a project input, with <staged>',
      [
        { staged: 'nothing else', stage: () => Effect.void },
        {
          staged: "a directory beside the project named the project's case-swapped name",
          stage: (root: string) =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const sibling = path.join(path.dirname(root), caseSwapped(path.basename(root)))
              yield* Effect.acquireRelease(
                fs.makeDirectory(sibling).pipe(Effect.orDie),
                () => fs.remove(sibling, { recursive: true }).pipe(Effect.ignore),
              )
            }),
        },
        {
          staged: 'a second directory in the project named rEPORTS',
          stage: (root: string) =>
            Effect.flatMap(
              Path.Path,
              (path) =>
                Effect.flatMap(FileSystem.FileSystem, (fs) =>
                  fs.makeDirectory(path.join(root, caseSwapped('Reports'))).pipe(Effect.orDie)),
            ),
        },
        {
          staged: "a dangling .git link, which sorts first and cannot be stat'ed",
          stage: (root: string) =>
            Effect.flatMap(
              Path.Path,
              (path) =>
                Effect.flatMap(FileSystem.FileSystem, (fs) =>
                  fs.symlink(path.join(root, 'missing-target'), path.join(root, '.git')).pipe(Effect.orDie)),
            ),
        },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project holding Reports/Mutation-Stream.jsonl whose tests need that file')(
            'project',
            () =>
              Effect.gen(function*() {
                const fs = yield* FileSystem.FileSystem
                const path = yield* Path.Path
                const root = yield* prepareProject(CASED_DEFAULT_CONFIG)
                yield* fs.makeDirectory(path.join(root, 'Reports'), { recursive: true }).pipe(Effect.orDie)
                yield* fs.writeFileString(path.join(root, CASED_DEFAULT_STREAM), '{}\n').pipe(Effect.orDie)
                yield* row.stage(root)
                return root
              }),
          ),
          When('the project is run')('run', (s) => invoke(s.project, RUN)),
          Then('the tests find the file and the run tests its mutants')((s, expect) =>
            expect({
              exitCode: s.run.exitCode,
              mutantsTested: eventsOf(s.run.stdout).some((event) => S.is(RunEvent.RunMutantTested)(event)),
            }).toEqual({ exitCode: 0, mutantsTested: true })
          ),
        ),
    )

    scenario(
      'A stream file whose first record is longer than 1 MiB is kept, and the run still streams on stdout',
      Gherkin.Do.pipe(
        Given('a project whose configured stream file starts with a stream record longer than 1 MiB')(
          'project',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* prepareProject(configNaming(CONFIGURED_STREAM))
              yield* fs.makeDirectory(path.join(root, path.dirname(CONFIGURED_STREAM)), { recursive: true }).pipe(
                Effect.orDie,
              )
              yield* fs.writeFileString(path.join(root, CONFIGURED_STREAM), OVERSIZED_STREAM_RECORD).pipe(Effect.orDie)
              return root
            }),
        ),
        When('the project is run')('run', (s) => invoke(s.project, RUN)),
        When('the stream file is read')(
          'stream',
          (s) => Effect.flatMap(Path.Path, (path) => readOptional(path.join(s.project, CONFIGURED_STREAM))),
        ),
        Then('the file keeps its content, stdout carries the verdict, and stderr names the file failure once')(
          (s, expect) =>
            expect({
              exitCode: s.run.exitCode,
              kept: Option.contains(s.stream, OVERSIZED_STREAM_RECORD),
              endsWithVerdict: S.is(RunEvent.VerdictReached)(eventsOf(s.run.stdout).at(-1)),
              fileFailuresLogged: s.run.stderr.split(DRAIN_FILE_FAILED).length - 1,
            }).toEqual({ exitCode: 0, kept: true, endsWithVerdict: true, fileFailuresLogged: 1 }),
        ),
      ),
    )

    scenarioOutline(
      'A stream file whose first record is <shape> is rewritten by the next run',
      [
        { shape: 'longer than 4096 bytes', record: LONG_STREAM_RECORD },
        { shape: 'torn by a run that died mid-write', record: TORN_RECORD },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a project whose configured stream file holds that record')(
            'project',
            () =>
              Effect.gen(function*() {
                const fs = yield* FileSystem.FileSystem
                const path = yield* Path.Path
                const root = yield* prepareProject(configNaming(CONFIGURED_STREAM))
                yield* fs.makeDirectory(path.join(root, path.dirname(CONFIGURED_STREAM)), { recursive: true }).pipe(
                  Effect.orDie,
                )
                yield* fs.writeFileString(path.join(root, CONFIGURED_STREAM), row.record).pipe(Effect.orDie)
                return root
              }),
          ),
          When('the project is run')('run', (s) => invoke(s.project, RUN)),
          When('the stream file is read')(
            'stream',
            (s) => Effect.flatMap(Path.Path, (path) => readOptional(path.join(s.project, CONFIGURED_STREAM))),
          ),
          Then('the run logged no file failure and the stream file holds its verdict')((s, expect) =>
            expect({
              exitCode: s.run.exitCode,
              fileFailuresLogged: s.run.stderr.split(DRAIN_FILE_FAILED).length - 1,
              streamEndsWithVerdict: Option.exists(
                s.stream,
                (text) => S.is(RunEvent.VerdictReached)(eventsOf(text).at(-1)),
              ),
            }).toEqual({ exitCode: 0, fileFailuresLogged: 0, streamEndsWithVerdict: true })
          ),
        ),
    )

    scenario(
      'A stream path that is a dangling link gets its target written, and the run logs no file failure',
      Gherkin.Do.pipe(
        Given('a project whose configured stream file is a link to a file that does not exist yet')(
          'project',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const root = yield* prepareProject(configNaming(CONFIGURED_STREAM))
              yield* fs.makeDirectory(path.join(root, path.dirname(CONFIGURED_STREAM)), { recursive: true }).pipe(
                Effect.orDie,
              )
              yield* fs.symlink(LINK_TARGET, path.join(root, CONFIGURED_STREAM)).pipe(Effect.orDie)
              return root
            }),
        ),
        When('the project is run')('run', (s) => invoke(s.project, RUN)),
        When('the link target is read')(
          'target',
          (s) =>
            Effect.flatMap(
              Path.Path,
              (path) => readOptional(path.join(s.project, path.dirname(CONFIGURED_STREAM), LINK_TARGET)),
            ),
        ),
        Then('the target holds the stream ending with the verdict, and no file failure is logged')((s, expect) =>
          expect({
            exitCode: s.run.exitCode,
            fileFailuresLogged: s.run.stderr.split(DRAIN_FILE_FAILED).length - 1,
            targetEndsWithVerdict: Option.exists(
              s.target,
              (text) => S.is(RunEvent.VerdictReached)(eventsOf(text).at(-1)),
            ),
          }).toEqual({ exitCode: 0, fileFailuresLogged: 0, targetEndsWithVerdict: true })
        ),
      ),
    )

    scenario(
      'A human run rewrites the stream file a human run left, and the next run re-runs no mutant',
      Gherkin.Do.pipe(
        Given('a project with no ignore patterns whose config names its stream file')(
          'project',
          () => prepareProject(configNaming(CONFIGURED_STREAM)),
        ),
        When('the project is run in human mode')('first', (s) => invoke(s.project, ['run'], 'human')),
        When('the project is run in human mode again with nothing changed')(
          'second',
          (s) => invoke(s.project, ['run'], 'human'),
        ),
        When('the files the second run left are read')('left', (s) => leftBehind(s.project, CONFIGURED_STREAM)),
        Then('the second run wrote the stream file, logged no file failure, and ran no test')(
          (s, expect) =>
            expect({
              exitCodes: [s.first.exitCode, s.second.exitCode],
              fileFailuresLogged: s.second.stderr.split(DRAIN_FILE_FAILED).length - 1,
              ...reusedEveryMutant(s.left, s.first, s.second),
            }).toEqual({ exitCodes: [0, 0], fileFailuresLogged: 0, ...EVERY_MUTANT_REUSED }),
        ),
      ),
    )
  })
