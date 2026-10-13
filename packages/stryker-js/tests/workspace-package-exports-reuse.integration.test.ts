import { NodeServices } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
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

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

const CONFIG = `export default {
  testRunner: 'vm',
  testFiles: ['test/**/*.test.js'],
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  checkers: [],
  concurrency: 1,
  reporters: [],
  cleanTempDir: 'always',
}
`

const SOURCE = 'export const add = (left, right) => left + right\n'

const TEST = [
  "import { expect, test } from 'vitest'",
  "import { double } from '@fixture/lib'",
  "import { add } from '../src/math.js'",
  '',
  "test('adds a doubled number', () => {",
  '  expect(add(1, double(2))).toBe(5)',
  '})',
  '',
].join('\n')

const UNRELATED_FILE = 'tools/unrelated.js'

interface RunOutcome {
  readonly exitCode: number
  readonly reuse: Option.Option<RunEvent.ReuseReported>
}

interface RunPair {
  readonly first: RunOutcome
  readonly second: RunOutcome
}

interface ReuseCounts {
  readonly reused: number
  readonly ran: number
  readonly refusedFor: ReadonlyArray<string>
}

type Services = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

const decodeLine = S.decodeOption(RunEvent.RunEventWireLine)

const reuseOf = (stdout: string): Option.Option<RunEvent.ReuseReported> =>
  Arr.findFirst(
    stdout.split('\n').flatMap((line) => Option.toArray(decodeLine(line))),
    (event): event is RunEvent.ReuseReported => S.is(RunEvent.ReuseReported)(event),
  )

const spawnRun = (root: string): Effect.Effect<RunOutcome, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'run'], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'machine', NO_COLOR: '1', GITHUB_ACTIONS: '', ALLOW_LOCAL_MUTATION: '1' },
          extendEnv: true,
        }),
      )
      const stdout = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      yield* Effect.forkScoped(handle.stderr.pipe(Stream.runDrain))
      const exitCode = yield* handle.exitCode
      return { exitCode: Number(exitCode), reuse: reuseOf(yield* Fiber.join(stdout)) }
    }),
  ).pipe(Effect.orDie)

const countsOf = (reuse: Option.Option<RunEvent.ReuseReported>): ReuseCounts =>
  Option.match(reuse, {
    onNone: () => ({ reused: -1, ran: -1, refusedFor: ['no reuse event'] }),
    onSome: (event) => ({
      reused: event.reused,
      ran: event.ran,
      refusedFor: Object.entries(event.refused).filter(([, count]) => count !== 0).map(([reason]) => reason),
    }),
  })

const encodeManifest = S.encodeEffect(S.fromJsonString(S.Json))

const writeFile = (root: string, relative: string, content: string): Effect.Effect<void, never, Services> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.join(root, relative)
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* fs.writeFileString(target, content)
  }).pipe(Effect.orDie)

const linkInstalledPackages = (root: string): Effect.Effect<void, never, Services> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@fixture'), { recursive: true })
    const installed = yield* fs.readDirectory(path.join(PACKAGE_ROOT, 'node_modules'))
    yield* Effect.forEach(
      installed,
      (entry) => fs.symlink(path.join(PACKAGE_ROOT, 'node_modules', entry), path.join(root, 'node_modules', entry)),
      { discard: true, concurrency: 'unbounded' },
    )
    yield* fs.symlink(path.join(root, 'lib'), path.join(root, 'node_modules', '@fixture', 'lib'))
  }).pipe(Effect.orDie)

const makeProject = (exports: S.Json): Effect.Effect<string, never, Services | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-exports-reuse-' }))
    const libManifest = yield* encodeManifest({ name: '@fixture/lib', type: 'module', exports })
    yield* Effect.forEach(
      [
        ['package.json', '{ "name": "exports-reuse-app", "type": "module", "private": true }\n'],
        ['stryker.config.mjs', CONFIG],
        ['src/math.js', SOURCE],
        ['test/math.test.js', TEST],
        [UNRELATED_FILE, 'export const unrelated = 1\n'],
        ['lib/package.json', libManifest],
        ['lib/dist/index.js', 'export const double = (value) => value * 2\n'],
        ['lib/dist/index.d.ts', 'export declare const double: (value: number) => number\n'],
      ] as const,
      ([relative, content]) => writeFile(root, relative, content),
      { discard: true },
    )
    yield* linkInstalledPackages(root)
    return root
  }).pipe(Effect.orDie)

interface Edit {
  readonly file: string
  readonly content: string
}

const UNRELATED_EDIT: Edit = { file: UNRELATED_FILE, content: 'export const unrelated = 2\n' }

const RUNTIME_EDIT: Edit = { file: 'lib/dist/index.js', content: 'export const double = (value) => value + value\n' }

const TYPES_FIRST_EXPORTS: S.Json = { '.': { import: { types: './dist/index.d.ts', default: './dist/index.js' } } }

const runTwiceAround = (root: string, edit: Edit): Effect.Effect<RunPair, never, Services> =>
  Effect.gen(function*() {
    const first = yield* spawnRun(root)
    yield* writeFile(root, edit.file, edit.content)
    const second = yield* spawnRun(root)
    return { first, second }
  })

Feature('Reusing verdicts for tests that import a linked workspace package', { timeout: 600_000 })
  .withLayer(NodeServices.layer)
  .live('the built stryker binary runs a project twice around an edit')
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'A linked package whose exports use <shape> keeps every verdict across an edit no test reaches',
      [
        { shape: 'a flat string root', exports: { '.': './dist/index.js' } },
        { shape: 'nested conditions with types first', exports: TYPES_FIRST_EXPORTS },
        { shape: 'an array fallback', exports: { '.': ['./dist/index.js'] } },
        { shape: 'a top-level array', exports: ['./dist/index.js'] },
        { shape: 'a null subpath beside the root', exports: { '.': './dist/index.js', './internal/*': null } },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a project whose test imports a linked package with ${row.shape} in its exports`)(
            'root',
            () => makeProject(row.exports),
          ),
          When('the binary runs the project, a file no test imports changes, and it runs again')(
            'runs',
            (s) => runTwiceAround(s.root, UNRELATED_EDIT),
          ),
          Then('both runs exit 0 and the second reuses every verdict the first one tested')((s, expect) => {
            const firstRan = countsOf(s.runs.first.reuse).ran
            return expect({
              firstExitCode: s.runs.first.exitCode,
              firstTestedMutants: firstRan > 0,
              secondExitCode: s.runs.second.exitCode,
              second: countsOf(s.runs.second.reuse),
            }).toEqual({
              firstExitCode: 0,
              firstTestedMutants: true,
              secondExitCode: 0,
              second: { reused: firstRan, ran: 0, refusedFor: [] },
            })
          }),
        ),
    )

    scenario(
      'A linked package whose types come first still re-tests its importers when only its runtime file changes',
      Gherkin.Do.pipe(
        Given('a project whose test imports a linked package that lists its types before its runtime file')(
          'root',
          () => makeProject(TYPES_FIRST_EXPORTS),
        ),
        When('the binary runs the project, only the package runtime file changes, and it runs again')(
          'runs',
          (s) => runTwiceAround(s.root, RUNTIME_EDIT),
        ),
        Then('both runs exit 0 and the second tests again every mutant the first one tested')((s, expect) => {
          const firstRan = countsOf(s.runs.first.reuse).ran
          return expect({
            firstExitCode: s.runs.first.exitCode,
            firstTestedMutants: firstRan > 0,
            secondExitCode: s.runs.second.exitCode,
            second: countsOf(s.runs.second.reuse),
          }).toEqual({
            firstExitCode: 0,
            firstTestedMutants: true,
            secondExitCode: 0,
            second: { reused: 0, ran: firstRan, refusedFor: ['closureChanged'] },
          })
        }),
      ),
    )
  })
