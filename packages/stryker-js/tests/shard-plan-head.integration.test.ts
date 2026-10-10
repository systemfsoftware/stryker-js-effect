import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import {
  type CliOutcome,
  CONFIG,
  decodePlan,
  encodePlan,
  requireBinary,
  singleShardPlanOf,
  SOURCE,
  spawnCli,
} from './__fixtures__/shard-cli.fixture.js'

const Feature = makeFeature({ it })

const COMMITTER = ['-c', 'user.email=contract@test', '-c', 'user.name=contract'] as const

const CONSUMER_PACKAGE = '{ "name": "shard-head-consumer", "type": "module", "private": true }\n'

const OTHER_HEAD = '0'.repeat(40)

const OTHER_BASE = 'a'.repeat(40)

const STALE_DIFF_FILE = 'plan-stale.json'

const FULL_STALE_FILE = 'plan-full-stale.json'

const CURRENT_FILE = 'plan-current.json'

const VERSION_ONE_FILE = 'plan-v1.json'

const NO_SCOPE_FILE = 'plan-v2-no-scope.json'

const NO_HEAD_FILE = 'plan-v2-no-head.json'

const VERSION_ONE_PLAN = JSON.stringify(
  { version: 1, targetSeconds: 1, shards: [], matrix: { include: [] } },
  null,
  2,
)

const NO_SCOPE_PLAN = JSON.stringify(
  { version: 2, targetSeconds: 1, shards: [], matrix: { include: [] } },
  null,
  2,
)

const NO_HEAD_PLAN = JSON.stringify(
  {
    version: 2,
    scope: { _tag: 'DiffScoped', base: OTHER_BASE },
    targetSeconds: 1,
    shards: [],
    matrix: { include: [] },
  },
  null,
  2,
)

const writeFile = (
  root: string,
  file: string,
  content: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.join(root, file)
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* fs.writeFileString(target, content)
  }).pipe(Effect.orDie)

interface Fixture {
  readonly root: string
  readonly realHead: string
}

const gitOutput = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(
      ChildProcess.make('git', args, {
        cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    )
    const stdout = yield* handle.stdout.pipe(Stream.decodeText, Stream.mkString)
    const stderr = yield* handle.stderr.pipe(Stream.decodeText, Stream.mkString)
    const exitCode = Number(yield* handle.exitCode)
    yield* Effect.when(
      Effect.die(new Error(`git ${args.join(' ')} failed (${exitCode}): ${stderr}`)),
      Effect.succeed(exitCode !== 0),
    )
    return stdout.trim()
  }).pipe(Effect.orDie)

const execGit = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.asVoid(gitOutput(cwd, args))

const prepareFixture = (): Effect.Effect<
  Fixture,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* requireBinary
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-shard-head-' }))
    yield* execGit(root, ['init', '-q'])
    yield* writeFile(root, 'package.json', CONSUMER_PACKAGE)
    yield* writeFile(root, 'stryker.config.mjs', CONFIG)
    yield* writeFile(root, 'src/math.js', SOURCE)
    yield* execGit(root, [...COMMITTER, 'add', '-A'])
    yield* execGit(root, [...COMMITTER, 'commit', '-q', '-m', 'init'])
    const realHead = yield* gitOutput(root, ['rev-parse', 'HEAD'])
    const planned = yield* spawnCli(root, ['plan', '--target-seconds', '1', '--out', 'plan.json'], 'machine')
    yield* Effect.when(
      Effect.die(new Error(`planning exited ${planned.exitCode}: ${planned.stdout}${planned.stderr}`)),
      Effect.succeed(planned.exitCode !== 0),
    )
    const planText = yield* fs.readFileString(path.join(root, 'plan.json'))
    const plan = Option.getOrThrowWith(
      decodePlan(planText),
      () => new Error('the planner did not write a decodable ShardPlan'),
    )
    const single = singleShardPlanOf(plan)
    yield* fs.writeFileString(
      path.join(root, STALE_DIFF_FILE),
      yield* encodePlan({ ...single, scope: { _tag: 'DiffScoped', base: realHead, head: OTHER_HEAD } }),
    )
    yield* fs.writeFileString(
      path.join(root, FULL_STALE_FILE),
      yield* encodePlan({
        ...single,
        scope: { _tag: 'FullScope', base: realHead, head: OTHER_HEAD, reason: '--since main' },
      }),
    )
    yield* fs.writeFileString(
      path.join(root, CURRENT_FILE),
      yield* encodePlan({ ...single, scope: { _tag: 'DiffScoped', base: realHead, head: realHead } }),
    )
    yield* writeFile(root, VERSION_ONE_FILE, VERSION_ONE_PLAN)
    yield* writeFile(root, NO_SCOPE_FILE, NO_SCOPE_PLAN)
    yield* writeFile(root, NO_HEAD_FILE, NO_HEAD_PLAN)
    return { root, realHead }
  }).pipe(Effect.orDie)

const runShard = (
  root: string,
  planFile: string,
  mode: 'human' | 'machine',
): Effect.Effect<CliOutcome, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  spawnCli(root, ['run', '--plan', planFile, '--shard', '1/1', '--out', 'reports/shard-1'], mode)

const shardDirExists = (
  root: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
  Effect.orDie(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      return yield* fs.exists(path.join(root, 'reports', 'shard-1'))
    }),
  )

interface ShardObservation {
  readonly exitCode: number
  readonly stderr: string
  readonly namedPlanHead: boolean
  readonly namedHead: boolean
  readonly shardDir: boolean
}

const observeShard = (fixture: Fixture, planFile: string, mode: 'human' | 'machine'): Effect.Effect<
  ShardObservation,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const ran = yield* runShard(fixture.root, planFile, mode)
    return {
      exitCode: ran.exitCode,
      stderr: ran.stderr,
      namedPlanHead: ran.stderr.includes(OTHER_HEAD),
      namedHead: ran.stderr.includes(fixture.realHead),
      shardDir: yield* shardDirExists(fixture.root),
    }
  })

interface PlanRefusalObservation {
  readonly exitCode: number
  readonly namesTheCode: boolean
  readonly namesTheNext: boolean
  readonly refusedBeforeTheHeadCheck: boolean
  readonly shardDir: boolean
}

const observePlanRefusal = (fixture: Fixture, planFile: string): Effect.Effect<
  PlanRefusalObservation,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const ran = yield* runShard(fixture.root, planFile, 'human')
    return {
      exitCode: ran.exitCode,
      namesTheCode: ran.stderr.includes('plan-undecodable'),
      namesTheNext: ran.stderr.includes('next: stryker plan --since <base>'),
      refusedBeforeTheHeadCheck: !ran.stderr.includes('the shard plan was made at commit'),
      shardDir: yield* shardDirExists(fixture.root),
    }
  })

Feature('Guarding a shard run against a plan this engine cannot use', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary reads the real HEAD of a temporary git repository before spawning a shard')
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'A <kind> plan whose head is not the repository HEAD refuses the shard before spawning a child',
      [
        { kind: 'diff-scoped', file: STALE_DIFF_FILE },
        { kind: 'full-scope', file: FULL_STALE_FILE },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a repository planned at HEAD into one shard, then rewritten to a different head')(
            'fixture',
            () => prepareFixture(),
          ),
          When('the shard runs for a person')('ran', (s) => observeShard(s.fixture, row.file, 'human')),
          Then('the run fails with the configuration class, names both commits and creates no shard output')((
            s,
            expect,
          ) =>
            expect({
              exitCode: s.ran.exitCode,
              namedPlanHead: s.ran.namedPlanHead,
              namedHead: s.ran.namedHead,
              staleReason: s.ran.stderr.includes('the shard plan was made at commit'),
              shardDir: s.ran.shardDir,
            }).toEqual({
              exitCode: 2,
              namedPlanHead: true,
              namedHead: true,
              staleReason: true,
              shardDir: false,
            })
          ),
        ),
    )

    scenario(
      'A diff-scoped plan made at the repository HEAD runs the shard and writes its output',
      Gherkin.Do.pipe(
        Given('a repository planned at HEAD into one shard with that same head')(
          'fixture',
          () => prepareFixture(),
        ),
        When('the shard runs for a person')('ran', (s) => observeShard(s.fixture, CURRENT_FILE, 'human')),
        Then('the run is admitted, reaches a verdict and leaves the shard output directory')((s, expect) =>
          expect({
            reachedAVerdict: s.ran.exitCode === 0 || s.ran.exitCode === 1,
            namedStalePlan: s.ran.stderr.includes('the shard plan was made at commit'),
            shardDir: s.ran.shardDir,
          }).toEqual({ reachedAVerdict: true, namedStalePlan: false, shardDir: true })
        ),
      ),
    )

    scenarioOutline(
      'A <kind> is refused as undecodable before any shard child runs',
      [
        { kind: 'version-1 plan', file: VERSION_ONE_FILE },
        { kind: 'version-2 plan with no scope', file: NO_SCOPE_FILE },
        { kind: 'version-2 plan whose scope names no head', file: NO_HEAD_FILE },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a repository planned at the latest commit alongside a plan this engine cannot decode')(
            'fixture',
            () => prepareFixture(),
          ),
          When('the shard runs for a person')('ran', (s) => observePlanRefusal(s.fixture, row.file)),
          Then('the run is refused with exit two, tells the operator to re-plan and writes no shard output')((
            s,
            expect,
          ) =>
            expect({
              exitCode: s.ran.exitCode,
              namesTheCode: s.ran.namesTheCode,
              namesTheNext: s.ran.namesTheNext,
              refusedBeforeTheHeadCheck: s.ran.refusedBeforeTheHeadCheck,
              shardDir: s.ran.shardDir,
            }).toEqual({
              exitCode: 2,
              namesTheCode: true,
              namesTheNext: true,
              refusedBeforeTheHeadCheck: true,
              shardDir: false,
            })
          ),
        ),
    )
  })
