import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import { ReportSurvivors, ReproducerList } from './__fixtures__/rerun-by-id.schema.js'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const REPORT_FILE = 'reports/mutation/mutation.json'
const REPRODUCERS_FILE = 'reports/mutation/reproducers.json'
const UNKNOWN_ID = 'deadbeefdeadbeef'

const CONSUMER_PACKAGE = '{ "name": "rerun-consumer", "type": "module", "private": true }\n'

const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  concurrency: 1,
  checkers: [],
  reporters: ['json'],
  cleanTempDir: 'always',
}
`

const SOURCE = 'export const sum = (a, b) => a + b\n'

interface StrykerRun {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

interface Project {
  readonly root: string
}

const prepareProject = (): Effect.Effect<Project, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-rerun-' }))
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@systemfsoftware'), { recursive: true })
    yield* fs.symlink(PACKAGE_ROOT, path.join(root, 'node_modules', '@systemfsoftware', 'stryker-js'))
    yield* fs.makeDirectory(path.join(root, 'src'))
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    yield* fs.writeFileString(path.join(root, '.gitignore'), 'reports/\n')
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), CONFIG)
    yield* fs.writeFileString(path.join(root, 'src', 'sum.js'), SOURCE)
    return { root }
  }).pipe(Effect.orDie)

const runStryker = (
  root: string,
  mode: 'human' | 'machine',
  args: ReadonlyArray<string>,
): Effect.Effect<StrykerRun, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, ...args], {
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

const readText = (file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return yield* fs.readFileString(path.join(file))
  }).pipe(Effect.orDie)

const readFirstReproducer = (root: string) =>
  Effect.gen(function*() {
    const text = yield* readText(`${root}/${REPRODUCERS_FILE}`)
    const reproducers = yield* S.decodeEffect(S.fromJsonString(ReproducerList))(text)
    return yield* Effect.fromOption(Arr.head(reproducers)).pipe(Effect.orDie)
  }).pipe(Effect.orDie)

const readFirstSurvivorId = (root: string) =>
  Effect.gen(function*() {
    const text = yield* readText(`${root}/${REPORT_FILE}`)
    const report = yield* S.decodeEffect(S.fromJsonString(ReportSurvivors))(text)
    const ids = Object.values(report.files).flatMap((file) =>
      file.mutants.filter((mutant) => mutant.status === 'Survived').map((mutant) => mutant.id)
    )
    return yield* Effect.fromOption(Arr.head(ids)).pipe(Effect.orDie)
  }).pipe(Effect.orDie)

const eventLinesOf = (stdout: string): ReadonlyArray<string> =>
  stdout.split('\n').flatMap((line) => (line.trimStart().startsWith('{') ? [line.trim()] : []))

const runFailuresOf = (stdout: string): ReadonlyArray<RunEvent.RunFailed> =>
  eventLinesOf(stdout).flatMap((line) => Option.toArray(S.decodeOption(S.fromJsonString(RunEvent.RunFailed))(line)))

const mutantDetailsOf = (stdout: string): ReadonlyArray<RunEvent.MutantDetailReported> =>
  eventLinesOf(stdout).flatMap((line) =>
    Option.toArray(S.decodeOption(S.fromJsonString(RunEvent.MutantDetailReported))(line))
  )

const reuseEventsOf = (stdout: string): ReadonlyArray<RunEvent.ReuseReported> =>
  eventLinesOf(stdout).flatMap((line) => Option.toArray(S.decodeOption(S.fromJsonString(RunEvent.ReuseReported))(line)))

const detailOf = (stdout: string, id: string): RunEvent.MutantDetailReported | undefined =>
  mutantDetailsOf(stdout).find((event) => event.id === id)

Feature('Re-running one mutant by its id', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary re-runs a single mutant and reports its detail')
  .body(({ scenario }) => {
    scenario(
      'A mutant that survived the last run is re-run alone and its verdict comes back',
      Gherkin.Do.pipe(
        Given('a project that has never been mutated')('project', () => prepareProject()),
        When('the whole project is mutated once')('ran', (s) => runStryker(s.project.root, 'machine', ['run'])),
        When('the first reproducer of that run is read')('reproducer', (s) => readFirstReproducer(s.project.root)),
        When('that mutant is re-run by its id')(
          'rerun',
          (s) => runStryker(s.project.root, 'machine', ['run', '--mutant', s.reproducer.id]),
        ),
        Then(
          'the re-run succeeds and reports that mutant surviving, with its covering tests, no killing test and its reproducer command',
        )(
          (s, expect) => {
            const detail = detailOf(s.rerun.stdout, s.reproducer.id)
            return expect({
              exitCode: s.rerun.exitCode,
              reproducerCommand: s.reproducer.command,
              detail: detail === undefined ? null : {
                id: detail.id,
                status: detail.status,
                killedBy: detail.killedBy,
                reproducer: detail.reproducer,
                coveringTestsIsArray: Array.isArray(detail.coveringTests),
              },
            }).toStrictEqual({
              exitCode: 0,
              reproducerCommand: `stryker run --mutant ${s.reproducer.id}`,
              detail: {
                id: s.reproducer.id,
                status: 'Survived',
                killedBy: null,
                reproducer: `stryker run --mutant ${s.reproducer.id}`,
                coveringTestsIsArray: true,
              },
            })
          },
        ),
      ),
    )

    scenario(
      'A mutant id no previous run produced is refused instead of guessed',
      Gherkin.Do.pipe(
        Given('a project that has never been mutated')('project', () => prepareProject()),
        When('a mutant with an id no report lists is re-run by a person')(
          'human',
          (s) => runStryker(s.project.root, 'human', ['run', '--mutant', UNKNOWN_ID]),
        ),
        When('the same mutant is re-run by a machine')(
          'machine',
          (s) => runStryker(s.project.root, 'machine', ['run', '--mutant', UNKNOWN_ID]),
        ),
        Then(
          'both runs are refused with the configuration exit code, the person is told the id and the remedy, and the machine reads the same refusal',
        )(
          (s, expect) => {
            const failure = Arr.head(runFailuresOf(s.machine.stdout))
            const says = (needle: string): boolean =>
              Option.getOrElse(
                Option.map(failure, (envelope) => {
                  const record = envelope.record
                  return Predicate.isTagged(record, 'ConfigInvalid') ? record.detail.includes(needle) : false
                }),
                () => false,
              )
            return expect({
              humanExitCode: s.human.exitCode,
              humanNamesTheId: s.human.stderr.includes(UNKNOWN_ID),
              humanNamesTheRemediation: s.human.stderr.includes('stryker run'),
              machineExitCode: s.machine.exitCode,
              machineCode: Option.map(failure, (envelope) => envelope.code),
              machineIsConfigInvalid: Option.exists(
                failure,
                (envelope) => Predicate.isTagged(envelope.record, 'ConfigInvalid'),
              ),
              machineNamesTheId: says(UNKNOWN_ID),
            }).toStrictEqual({
              humanExitCode: 2,
              humanNamesTheId: true,
              humanNamesTheRemediation: true,
              machineExitCode: 2,
              machineCode: Option.some(2),
              machineIsConfigInvalid: true,
              machineNamesTheId: true,
            })
          },
        ),
      ),
    )

    scenario(
      'An unchanged mutant is answered from its remembered verdict',
      Gherkin.Do.pipe(
        Given('a project that has never been mutated')('project', () => prepareProject()),
        When('the whole project is mutated once')('ran', (s) => runStryker(s.project.root, 'machine', ['run'])),
        When('the first survivor of that run is read')('survivor', (s) => readFirstSurvivorId(s.project.root)),
        When('that survivor is re-run once')(
          'first',
          (s) => runStryker(s.project.root, 'machine', ['run', '--mutant', s.survivor]),
        ),
        When('the same mutant is re-run again with no source change')(
          'second',
          (s) => runStryker(s.project.root, 'machine', ['run', '--mutant', s.survivor]),
        ),
        Then('the second run reuses the verdict instead of executing the mutant')((s, expect) => {
          const reuse = Arr.head(reuseEventsOf(s.second.stdout))
          const detail = detailOf(s.second.stdout, s.survivor)
          return expect({
            exitCode: s.second.exitCode,
            reused: Option.map(reuse, (event) => event.reused),
            ran: Option.map(reuse, (event) => event.ran),
            detailStatus: Option.map(Option.fromUndefinedOr(detail), (found) => found.status),
            detailReproducer: Option.map(Option.fromUndefinedOr(detail), (found) => found.reproducer),
          }).toStrictEqual({
            exitCode: 0,
            reused: Option.some(1),
            ran: Option.some(0),
            detailStatus: Option.some('Survived'),
            detailReproducer: Option.some(`stryker run --mutant ${s.survivor}`),
          })
        }),
      ),
    )
  })
