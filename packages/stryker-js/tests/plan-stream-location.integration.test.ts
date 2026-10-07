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
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const PROJECT_NAMES = ['proj-a', 'proj-b'] as const

const INCREMENTAL_FILE = 'reports/stryker-incremental.json'

const PROJECT_STREAM_FILE = 'reports/mutation-stream.jsonl'

const ROOT_STREAM_FILE = 'reports/mutation-stream.jsonl'

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

const PARTICIPANT = '{ "type": "commonjs" }\n'

const CONFIG = `export default {
  testRunner: 'vm',
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  incrementalSources: ['reports/stryker-incremental-*.json'],
  checkers: [],
  concurrency: 1,
  reporters: [],
  cleanTempDir: 'always',
}
`

const ALPHA_SOURCE = [
  'function add(left, right) {',
  '  return left + right;',
  '}',
  '',
  'function label() {',
  "  return 'alpha';",
  '}',
  '',
  'module.exports = { add, label };',
  '',
].join('\n')

const BETA_SOURCE = [
  'function double(value) {',
  '  return value * 2;',
  '}',
  '',
  'module.exports = { double };',
  '',
].join('\n')

const ALPHA_TEST = [
  "import { expect, test } from 'vitest'",
  "import alpha from '../src/alpha.js'",
  '',
  "test('adds two numbers', () => {",
  '  expect(alpha.add(1, 2)).toBe(3)',
  '})',
  '',
  "test('labels the alpha module', () => {",
  "  expect(alpha.label()).toBe('alpha')",
  '})',
  '',
].join('\n')

const BETA_TEST = [
  "import { expect, test } from 'vitest'",
  "import beta from '../src/beta.js'",
  '',
  "test('doubles a number', () => {",
  '  expect(beta.double(2)).toBe(4)',
  '})',
  '',
].join('\n')

interface ExecOutcome {
  readonly exitCode: number
  readonly output: string
}

const spawnCli = (
  root: string,
  args: ReadonlyArray<string>,
): Effect.Effect<ExecOutcome, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, ...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'machine', NO_COLOR: '1', GITHUB_ACTIONS: '', ALLOW_LOCAL_MUTATION: '1' },
          extendEnv: true,
        }),
      )
      const stdout = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const stderr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      return {
        exitCode: Number(exitCode),
        output: `${yield* Fiber.join(stdout)}\n${yield* Fiber.join(stderr)}`,
      }
    }),
  ).pipe(Effect.orDie)

const decodeReuse = (line: string) => S.decodeResult(S.fromJsonString(RunEvent.ReuseReported))(line)

const reuseEventOf = (streamText: string): RunEvent.ReuseReported => {
  const decoded = streamText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{"_tag":"reuse"'))
    .map(decodeReuse)
  const found = decoded.flatMap((result) => (Result.isSuccess(result) ? [result.success] : []))[0]
  return Option.getOrThrowWith(
    Option.fromUndefinedOr(found),
    () =>
      new Error(
        `no decodable reuse event:\n${
          decoded.map((result) =>
            Result.match(result, {
              onFailure: (error) => error.message,
              onSuccess: (event) => `decoded reused ${event.reused}`,
            })
          ).join('\n---\n')
        }`,
      ),
  )
}

const NO_REFUSALS: RunEvent.ReuseRefusals = {
  semanticsChanged: 0,
  policyChanged: 0,
  runInputsChanged: 0,
  closureChanged: 0,
  closureAnalysisFailed: 0,
  programChanged: 0,
  timeoutUnreproduced: 0,
  flakyDependency: 0,
  noPriorRecord: 0,
}

interface Fixture {
  readonly root: string
}

const makeFixture = (): Effect.Effect<Fixture, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-plan-stream-' }))
    yield* fs.writeFileString(path.join(root, 'package.json'), PARTICIPANT)
    yield* fs.makeDirectory(path.join(root, 'node_modules'), { recursive: true })
    const installed = yield* fs.readDirectory(path.join(PACKAGE_ROOT, 'node_modules'))
    yield* Effect.forEach(
      installed,
      (entry) =>
        Effect.gen(function*() {
          const target = path.join(root, 'node_modules', entry)
          const present = yield* fs.exists(target)
          yield* Effect.when(
            fs.symlink(path.join(PACKAGE_ROOT, 'node_modules', entry), target),
            Effect.succeed(!present),
          )
        }),
      { discard: true },
    )
    yield* Effect.forEach(
      PROJECT_NAMES,
      (name) =>
        Effect.gen(function*() {
          const project = path.join(root, name)
          yield* fs.makeDirectory(path.join(project, 'src'), { recursive: true })
          yield* fs.makeDirectory(path.join(project, 'test'), { recursive: true })
          yield* fs.writeFileString(
            path.join(project, 'package.json'),
            `{ "name": "${name}", "type": "commonjs", "private": true }\n`,
          )
          yield* fs.writeFileString(path.join(project, 'stryker.config.mjs'), CONFIG)
          yield* fs.writeFileString(path.join(project, 'src', 'alpha.js'), ALPHA_SOURCE)
          yield* fs.writeFileString(path.join(project, 'src', 'beta.js'), BETA_SOURCE)
          yield* fs.writeFileString(path.join(project, 'test', 'alpha.test.mjs'), ALPHA_TEST)
          yield* fs.writeFileString(path.join(project, 'test', 'beta.test.mjs'), BETA_TEST)
        }),
      { discard: true },
    )
    return { root }
  }).pipe(Effect.orDie)

interface Outcome {
  readonly coldRun: ExecOutcome
  readonly coldRan: number
  readonly reportWritten: boolean
  readonly plan: ExecOutcome
  readonly streamInFirstProject: boolean
  readonly streamAtRoot: boolean
  readonly warmRun: ExecOutcome
  readonly warmReuse: RunEvent.ReuseReported
}

const runPlanThenRun = (
  fixture: Fixture,
): Effect.Effect<
  Outcome,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { root } = fixture
    const first = path.join(root, 'proj-a')
    const outside = yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-plan-stream-out-' })
    const coldRun = yield* spawnCli(first, [
      'run',
      '--out',
      path.join(outside, 'cold'),
      '--progressStreamFile',
      path.join(outside, 'cold-stream.jsonl'),
    ])
    const reportWritten = yield* fs.exists(path.join(first, INCREMENTAL_FILE))
    const plan = yield* spawnCli(root, [
      'plan',
      '--target-seconds',
      '0.05',
      '--max-shards',
      '4',
      '--projects',
      PROJECT_NAMES.join(','),
      '--out',
      'plan.json',
    ])
    const streamInFirstProject = yield* fs.exists(path.join(first, PROJECT_STREAM_FILE))
    const streamAtRoot = yield* fs.exists(path.join(root, ROOT_STREAM_FILE))
    yield* fs.remove(path.join(root, ROOT_STREAM_FILE)).pipe(Effect.orElseSucceed(() => {}))
    const warmRun = yield* spawnCli(first, [
      'run',
      '--out',
      path.join(outside, 'warm'),
      '--progressStreamFile',
      path.join(outside, 'warm-stream.jsonl'),
    ])
    return {
      coldRun,
      coldRan: reuseEventOf(coldRun.output).ran,
      reportWritten,
      plan,
      streamInFirstProject,
      streamAtRoot,
      warmRun,
      warmReuse: reuseEventOf(warmRun.output),
    }
  }).pipe(Effect.orDie)

Feature('Writing the plan stream beside the invocation root', { timeout: 240_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary plans from a root and then runs one of its projects unchanged')
  .body(({ scenario }) => {
    scenario(
      'A project whose verdicts a root plan priced still reuses every verdict when run',
      Gherkin.Do.pipe(
        Given('a repo whose two projects each hold four mutable source files')(
          'fixture',
          () => makeFixture(),
        ),
        When('the binary runs the first project, plans the root and runs that project again')(
          'outcome',
          (s) => runPlanThenRun(s.fixture),
        ),
        Then('the plan leaves no stream inside the project and the second run reuses every verdict')(
          (s, expect) => {
            const { outcome } = s
            return expect({
              coldRunExitCode: outcome.coldRun.exitCode,
              coldRunMutants: outcome.coldRan > 0,
              reportWritten: outcome.reportWritten,
              planExitCode: outcome.plan.exitCode,
              streamInFirstProject: outcome.streamInFirstProject,
              streamAtRoot: outcome.streamAtRoot,
              warmRunExitCode: outcome.warmRun.exitCode,
              warmReuse: `${outcome.warmReuse.reused} reused, ${outcome.warmReuse.ran} ran, refused=${
                JSON.stringify(outcome.warmReuse.refused)
              }`,
            }).toEqual({
              coldRunExitCode: 0,
              coldRunMutants: true,
              reportWritten: true,
              planExitCode: 0,
              streamInFirstProject: false,
              streamAtRoot: true,
              warmRunExitCode: 0,
              warmReuse: `${outcome.coldRan} reused, 0 ran, refused=${JSON.stringify(NO_REFUSALS)}`,
            })
          },
        ),
      ),
    )
  })
