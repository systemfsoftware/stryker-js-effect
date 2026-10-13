import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { ShardPlanDiffScoped } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import { committerArgs, CONTRACT_GIT_IDENTITY, execGit, gitOutput, writeFile } from './__fixtures__/git-repo.fixture.js'
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

const COMMITTER = committerArgs(CONTRACT_GIT_IDENTITY)

const CONSUMER_PACKAGE = '{ "name": "shard-head-consumer", "type": "module", "private": true }\n'

const OTHER_HEAD = '0'.repeat(40)

const OTHER_BASE = 'a'.repeat(40)

const STALE_DIFF_FILE = 'plan-stale.json'

const FULL_STALE_FILE = 'plan-full-stale.json'

const CURRENT_FILE = 'plan.json'

const UNRELATED_FILE = 'notes.txt'

const LEAF_OUT = 'reports/shard-1'

const SPARE_FILE = 'src/spare.js'

const SPARE_SOURCE = [
  'export const spare = (a, b) => {',
  '  const total = a + b',
  '  return total + 1',
  '}',
  '',
].join('\n')

const PLANNED_FILE_CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['${SPARE_FILE}'],
  coverageAnalysis: 'off',
  concurrency: 1,
  reporters: [],
  thresholds: { high: 80, low: 60, break: 100 },
}
`

const DIRTY_SOURCE = [
  'export const add = (a, b) => {',
  '  const sum = a + b',
  '  return sum + 0',
  '}',
  'export const sub = (a, b) => {',
  '  const difference = a - b',
  '  return difference - 0',
  '}',
  '',
].join('\n')

const REDIRTIED_SOURCE = DIRTY_SOURCE.replace('return sum + 0', 'return sum + 1')

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

interface Fixture {
  readonly root: string
  readonly head: string
  readonly elsewhere: string
}

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
    const head = yield* gitOutput(root, ['rev-parse', 'HEAD'])
    yield* writeFile(root, 'src/math.js', DIRTY_SOURCE)
    const planned = yield* spawnCli(
      root,
      ['plan', '--target-seconds', '1', '--max-shards', '1', '--out', CURRENT_FILE, '--since', head],
      'machine',
    )
    yield* Effect.when(
      Effect.die(new Error(`planning exited ${planned.exitCode}: ${planned.stdout}${planned.stderr}`)),
      Effect.succeed(planned.exitCode !== 0),
    )
    const plan = Option.getOrThrowWith(
      decodePlan(yield* fs.readFileString(path.join(root, CURRENT_FILE))),
      () => new Error('the planner did not write a decodable ShardPlan'),
    )
    const single = singleShardPlanOf(plan)
    const scheduled = single.shards.flatMap((shard) => shard.projects.flatMap((entry) => entry.mutants))
    yield* Effect.when(
      Effect.die(new Error(`the plan scoped from an uncommitted edit scheduled ${scheduled.length} mutants`)),
      Effect.succeed(!S.is(ShardPlanDiffScoped)(single.scope) || scheduled.length === 0),
    )
    yield* fs.writeFileString(
      path.join(root, STALE_DIFF_FILE),
      yield* encodePlan({
        ...single,
        scope: { _tag: 'DiffScoped', base: head, head: OTHER_HEAD, sources: '', files: [] },
      }),
    )
    yield* fs.writeFileString(
      path.join(root, FULL_STALE_FILE),
      yield* encodePlan({
        ...single,
        scope: { _tag: 'FullScope', base: head, head: OTHER_HEAD, sources: '', files: [], reason: '--since main' },
      }),
    )
    yield* writeFile(root, VERSION_ONE_FILE, VERSION_ONE_PLAN)
    yield* writeFile(root, NO_SCOPE_FILE, NO_SCOPE_PLAN)
    yield* writeFile(root, NO_HEAD_FILE, NO_HEAD_PLAN)
    const elsewhere = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-shard-head-elsewhere-' }))
    yield* writeFile(elsewhere, 'package.json', CONSUMER_PACKAGE)
    yield* writeFile(elsewhere, 'stryker.config.mjs', CONFIG)
    yield* writeFile(elsewhere, 'src/math.js', SOURCE)
    yield* fs.copyFile(path.join(root, CURRENT_FILE), path.join(elsewhere, CURRENT_FILE))
    yield* fs.copyFile(path.join(root, STALE_DIFF_FILE), path.join(elsewhere, STALE_DIFF_FILE))
    return { root, head, elsewhere }
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

const runLeaf = (
  root: string,
  planFile: string,
  project: string,
  mode: 'human' | 'machine',
): Effect.Effect<CliOutcome, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  spawnCli(
    root,
    ['run', '--plan', planFile, '--shard', '1/1', '--project', project, '--out', LEAF_OUT],
    mode,
  )

const commitAll = (
  root: string,
  message: string,
): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function*() {
    yield* execGit(root, [...COMMITTER, 'add', '-A'])
    yield* execGit(root, [...COMMITTER, 'commit', '-q', '-m', message])
  })

const plannedIdsOf = (
  root: string,
): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.orDie(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const plan = Option.getOrThrowWith(
        decodePlan(yield* fs.readFileString(path.join(root, CURRENT_FILE))),
        () => new Error('the planner did not write a decodable ShardPlan'),
      )
      return plan.shards.flatMap((shard) => shard.projects.flatMap((entry) => entry.mutants))
    }),
  )

interface ShardObservation {
  readonly exitCode: number
  readonly stderr: string
  readonly namedPlanHead: boolean
  readonly namedHead: boolean
  readonly namedSourceDigest: boolean
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
      namedHead: ran.stderr.includes(fixture.head),
      namedSourceDigest: ran.stderr.includes('source digest'),
      shardDir: yield* shardDirExists(fixture.root),
    }
  })

const observePlanAt = (
  fixture: Fixture,
  file: string,
  outside: boolean,
  mode: 'human' | 'machine',
): Effect.Effect<
  ShardObservation,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    return yield* observeShard(fixture, outside ? path.join(fixture.elsewhere, file) : file, mode)
  })

interface GitFailureObservation {
  readonly exitCode: number
  readonly stderr: string
  readonly namesTheCommand: boolean
  readonly doublesTheBinary: boolean
  readonly shardDir: boolean
  readonly leafExitCode: number
  readonly leafNamesTheCommand: boolean
}

const observeGitFailure = (root: string): Effect.Effect<
  GitFailureObservation,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const ran = yield* runShard(root, CURRENT_FILE, 'human')
    const shardDir = yield* shardDirExists(root)
    const leaf = yield* runLeaf(root, CURRENT_FILE, '.', 'human')
    return {
      exitCode: ran.exitCode,
      stderr: ran.stderr,
      namesTheCommand: ran.stderr.includes('git rev-parse HEAD failed'),
      doublesTheBinary: ran.stderr.includes('git git'),
      shardDir,
      leafExitCode: leaf.exitCode,
      leafNamesTheCommand: leaf.stderr.includes('git rev-parse HEAD failed'),
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
      'A scoped plan runs the shard <where> only while its checkout can read the repository',
      [
        {
          where: 'from inside its checkout',
          outside: false,
          expected: { reachesAVerdict: true, refusedOnGit: false, shardDir: true },
        },
        {
          where: 'from a tree that cannot see the repository',
          outside: true,
          expected: { reachesAVerdict: false, refusedOnGit: true, shardDir: true },
        },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a repository planned at HEAD from an uncommitted edit into the untracked plan.json')(
            'fixture',
            () => prepareFixture(),
          ),
          When('the shard runs for a person')(
            'ran',
            (s) => observePlanAt(s.fixture, CURRENT_FILE, row.outside, 'human'),
          ),
          Then('the run reaches a verdict from the checkout and is refused where it cannot read git')((s, expect) =>
            expect({
              reachedAVerdict: s.ran.exitCode === 0 || s.ran.exitCode === 1,
              refusedOnGit: s.ran.stderr.includes('git rev-parse HEAD failed'),
              namedStalePlan: s.ran.stderr.includes('the shard plan was made at commit'),
              shardDir: s.ran.shardDir,
            }).toEqual({
              reachedAVerdict: row.expected.reachesAVerdict,
              refusedOnGit: row.expected.refusedOnGit,
              namedStalePlan: false,
              shardDir: row.expected.shardDir,
            })
          ),
        ),
    )

    scenario(
      'A plan is refused once a file it schedules mutants in changes without a commit',
      Gherkin.Do.pipe(
        Given('a repository planned from an uncommitted edit to a file it schedules mutants in')(
          'fixture',
          () => prepareFixture(),
        ),
        When('that file changes once more without a commit and the shard runs')('ran', (s) =>
          Effect.gen(function*() {
            yield* writeFile(s.fixture.root, 'src/math.js', REDIRTIED_SOURCE)
            const ran = yield* runShard(s.fixture.root, CURRENT_FILE, 'human')
            return { ran, shardDir: yield* shardDirExists(s.fixture.root) }
          })),
        Then('the run exits two, names the plan base and the next action and creates no shard output')((s, expect) =>
          expect({
            exitCode: s.ran.ran.exitCode,
            namesTheBase: s.ran.ran.stderr.includes(s.fixture.head),
            namesTheSourceDigest: s.ran.ran.stderr.includes('source digest'),
            namesTheNext: s.ran.ran.stderr.includes('next: stryker plan --since'),
            shardDir: s.ran.shardDir,
          }).toEqual({
            exitCode: 2,
            namesTheBase: true,
            namesTheSourceDigest: true,
            namesTheNext: true,
            shardDir: false,
          })
        ),
      ),
    )

    scenario(
      'A plan is admitted when only files it does not schedule mutants in change',
      Gherkin.Do.pipe(
        Given('a repository planned from an uncommitted edit to a file it schedules mutants in')(
          'fixture',
          () => prepareFixture(),
        ),
        When('an unrelated untracked file is added and an unrelated tracked file edited, then the shard runs')(
          'ran',
          (s) =>
            Effect.gen(function*() {
              yield* writeFile(s.fixture.root, UNRELATED_FILE, 'notes\n')
              yield* writeFile(s.fixture.root, 'package.json', `${CONSUMER_PACKAGE}\n`)
              const ran = yield* runShard(s.fixture.root, CURRENT_FILE, 'human')
              return { ran, shardDir: yield* shardDirExists(s.fixture.root) }
            }),
        ),
        Then('the run is admitted, reaches a verdict and leaves the shard output directory')((s, expect) =>
          expect({
            reachedAVerdict: s.ran.ran.exitCode === 0 || s.ran.ran.exitCode === 1,
            refusedOnSources: s.ran.ran.stderr.includes('source digest'),
            shardDir: s.ran.shardDir,
          }).toEqual({ reachedAVerdict: true, refusedOnSources: false, shardDir: true })
        ),
      ),
    )

    scenarioOutline(
      'A <kind> plan whose head is not the repository HEAD is refused <where>',
      [
        { where: 'in the checkout', kind: 'diff-scoped', file: STALE_DIFF_FILE, outside: false },
        { where: 'from outside the checkout', kind: 'diff-scoped', file: STALE_DIFF_FILE, outside: true },
        { where: 'in the checkout', kind: 'full-scope', file: FULL_STALE_FILE, outside: false },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given('a repository planned at HEAD into one shard, then rewritten to a different head')(
            'fixture',
            () => prepareFixture(),
          ),
          When('the shard runs for a person')('ran', (s) => observePlanAt(s.fixture, row.file, row.outside, 'human')),
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
      'A scoped plan whose checkout is not a git repository is refused as a configuration error and writes no shard output',
      Gherkin.Do.pipe(
        Given('a project and its scoped plan copied into a directory that is not a git repository')(
          'fixture',
          () => prepareFixture(),
        ),
        When('the shard runs in that directory')('ran', (s) => observeGitFailure(s.fixture.elsewhere)),
        Then('the run exits two, names the git command it could not read HEAD with and creates no shard output')((
          s,
          expect,
        ) =>
          expect({
            exitCode: s.ran.exitCode,
            namesTheCommand: s.ran.namesTheCommand,
            doublesTheBinary: s.ran.doublesTheBinary,
            shardDir: s.ran.shardDir,
            leafExitCode: s.ran.leafExitCode,
            leafNamesTheCommand: s.ran.leafNamesTheCommand,
          }).toEqual({
            exitCode: 2,
            namesTheCommand: true,
            doublesTheBinary: false,
            shardDir: false,
            leafExitCode: 2,
            leafNamesTheCommand: true,
          })
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

    scenario(
      'A scoped plan whose repository moved on is refused for the single project leaf run too',
      Gherkin.Do.pipe(
        Given('a repository planned at HEAD from an uncommitted edit, and that edit then committed')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const fixture = yield* prepareFixture()
              yield* commitAll(fixture.root, 'commit the edit the plan was scoped from')
              return { ...fixture, movedHead: yield* gitOutput(fixture.root, ['rev-parse', 'HEAD']) }
            }),
        ),
        When('the one planned project runs as a leaf')('ran', (s) =>
          Effect.gen(function*() {
            const ran = yield* runLeaf(s.fixture.root, CURRENT_FILE, '.', 'human')
            return { ran, shardDir: yield* shardDirExists(s.fixture.root) }
          })),
        Then('the run exits two naming both commits and the stale reason, and creates no shard output')((s, expect) =>
          expect({
            exitCode: s.ran.ran.exitCode,
            namesThePlanHead: s.ran.ran.stderr.includes(s.fixture.head),
            namesTheMovedHead: s.ran.ran.stderr.includes(s.fixture.movedHead),
            namesTheStaleReason: s.ran.ran.stderr.includes('the shard plan was made at commit'),
            shardDir: s.ran.shardDir,
          }).toEqual({
            exitCode: 2,
            namesThePlanHead: true,
            namesTheMovedHead: true,
            namesTheStaleReason: true,
            shardDir: false,
          })
        ),
      ),
    )

    scenario(
      'A plan is refused once the configuration stops producing a mutant it scheduled',
      Gherkin.Do.pipe(
        Given('a repository planned at HEAD from an uncommitted edit into the untracked plan.json')(
          'fixture',
          () => prepareFixture(),
        ),
        When(
          'the configuration stops mutating the planned file, the work moves to another file and the leaf runs',
        )('ran', (s) =>
          Effect.gen(function*() {
            const plannedIds = yield* plannedIdsOf(s.fixture.root)
            yield* writeFile(s.fixture.root, SPARE_FILE, SPARE_SOURCE)
            yield* writeFile(s.fixture.root, 'stryker.config.mjs', PLANNED_FILE_CONFIG)
            const leaf = yield* runLeaf(s.fixture.root, CURRENT_FILE, '.', 'human')
            const shardDir = yield* shardDirExists(s.fixture.root)
            const orchestrated = yield* runShard(s.fixture.root, CURRENT_FILE, 'human')
            return { leaf, orchestrated, plannedIds, shardDir }
          })),
        Then('both the single project run and the orchestrated run exit two naming the plan and the missing ids')((
          s,
          expect,
        ) =>
          expect({
            leafExitCode: s.ran.leaf.exitCode,
            leafNamesThePlan: s.ran.leaf.stderr.includes(CURRENT_FILE),
            leafNamesTheCount: s.ran.leaf.stderr.includes(
              `schedules ${new Set(s.ran.plannedIds).size} mutant(s) this run does not discover`,
            ),
            leafNamesAMissingId: s.ran.plannedIds.some((id) => s.ran.leaf.stderr.includes(id)),
            leafNamesTheNext: s.ran.leaf.stderr.includes('re-run stryker plan'),
            leafShardDir: s.ran.shardDir,
            orchestratedExitCode: s.ran.orchestrated.exitCode,
            orchestratedNamesTheRefusal: s.ran.orchestrated.stderr.includes('the shard plan at'),
          }).toEqual({
            leafExitCode: 2,
            leafNamesThePlan: true,
            leafNamesTheCount: true,
            leafNamesAMissingId: true,
            leafNamesTheNext: true,
            leafShardDir: false,
            orchestratedExitCode: 2,
            orchestratedNamesTheRefusal: true,
          })
        ),
      ),
    )

    scenario(
      'A leaf run of a plan it can still use reports no unknown configuration option',
      Gherkin.Do.pipe(
        Given('a repository planned at HEAD from an uncommitted edit into the untracked plan.json')(
          'fixture',
          () => prepareFixture(),
        ),
        When('the one planned project runs as a leaf')('ran', (s) =>
          Effect.gen(function*() {
            const ran = yield* runLeaf(s.fixture.root, CURRENT_FILE, '.', 'human')
            return { ran }
          })),
        Then('the run reaches a verdict without reporting an unknown configuration option')((s, expect) =>
          expect({
            reachedAVerdict: s.ran.ran.exitCode === 0 || s.ran.ran.exitCode === 1,
            unknownOption: s.ran.ran.stderr.includes('Unknown stryker config option'),
          }).toEqual({ reachedAVerdict: true, unknownOption: false })
        ),
      ),
    )
  })
