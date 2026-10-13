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

interface ExportsShape {
  readonly name: string
  readonly exports: S.Json
}

const SHAPES: ReadonlyArray<ExportsShape> = [
  { name: 'a flat string root', exports: { '.': './dist/index.js' } },
  {
    name: 'nested conditions with types first',
    exports: { '.': { import: { types: './dist/index.d.ts', default: './dist/index.js' } } },
  },
  { name: 'an array fallback', exports: { '.': ['./dist/index.js'] } },
  { name: 'a null subpath beside the root', exports: { '.': './dist/index.js', './internal/*': null } },
]

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

const makeProject = (shape: ExportsShape): Effect.Effect<string, never, Services | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-exports-reuse-' }))
    const libManifest = yield* encodeManifest({ name: '@fixture/lib', type: 'module', exports: shape.exports })
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

const runTwiceAroundAnUnrelatedEdit = (root: string): Effect.Effect<RunPair, never, Services> =>
  Effect.gen(function*() {
    const first = yield* spawnRun(root)
    yield* writeFile(root, UNRELATED_FILE, 'export const unrelated = 2\n')
    const second = yield* spawnRun(root)
    return { first, second }
  })

Feature('Keeping verdicts for a linked package whatever shape its exports take', { timeout: 600_000 })
  .withLayer(NodeServices.layer)
  .live('the built stryker binary runs a project twice around an edit to a file no test imports')
  .body(({ scenario }) => {
    for (const shape of SHAPES) {
      scenario(
        `A linked package whose exports use ${shape.name} keeps every verdict`,
        Gherkin.Do.pipe(
          Given(`a project whose test imports a linked package with ${shape.name} in its exports`)(
            'root',
            () => makeProject(shape),
          ),
          When('the binary runs the project, a file no test imports changes, and it runs again')(
            'runs',
            (s) => runTwiceAroundAnUnrelatedEdit(s.root),
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
    }
  })
