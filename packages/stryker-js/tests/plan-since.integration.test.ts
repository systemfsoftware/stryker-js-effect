import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine, GitDiff, GitDiffSchema } from '@systemfsoftware/stryker-js'
import { RunEvent, type ShardPlan, type ShardPlanScope } from '@systemfsoftware/stryker-js-cli-contract'
import * as Cause from 'effect/Cause'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import { filePorts, removeWorkspace } from './__fixtures__/check-cost-workspace.fixture.js'
import { requireBinary, spawnCli } from './__fixtures__/shard-cli.fixture.js'

const Feature = makeFeature({ it })

const TARGET_FILE = 'src/target.ts'
const OTHER_FILE = 'src/other.ts'
const README_FILE = 'docs/readme.md'
const CONFIG_FILE = 'stryker.config.mjs'

const TARGET_SOURCE = [
  'export const target = (value: number): number => {',
  '  const doubled = value * 2',
  '  return doubled + 1',
  '}',
  '',
].join('\n')

const OTHER_SOURCE = [
  'export const other = (value: number): number => {',
  '  const tripled = value * 3',
  '  return tripled - 1',
  '}',
  '',
].join('\n')

const README_SOURCE = '# readme\n'

const FULL_MUTATE = ['src/**/*.ts'] as const
const LINE_MUTATE = ['src/target.ts:3-3'] as const

const FAKE_BASE = 'fake-base-sha'
const FAKE_HEAD = 'fake-head-sha'

const CONFIG_SINCE = 'HEAD~2'

const configSourceOf = (mutate: ReadonlyArray<string>, since?: string): string =>
  `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ${JSON.stringify(mutate)},
${since === undefined ? '' : `  since: ${JSON.stringify(since)},\n`}  coverageAnalysis: 'off',
  checkers: [],
  reporters: [],
  cleanTempDir: 'always',
}
`

const filesOf = (
  mutate: ReadonlyArray<string>,
  since?: string,
): Readonly<Record<string, string>> => ({
  'package.json': '{ "name": "plan-since-consumer", "type": "module", "private": true }\n',
  [CONFIG_FILE]: configSourceOf(mutate, since),
  [TARGET_FILE]: TARGET_SOURCE,
  [OTHER_FILE]: OTHER_SOURCE,
  [README_FILE]: README_SOURCE,
})

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

const writeFiles = (
  entries: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory())
    yield* Effect.forEach(
      entries,
      ([file, content]) =>
        Effect.gen(function*() {
          const target = path.join(root, file)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    return root
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const writeWorkspace = (
  mutate: ReadonlyArray<string> = FULL_MUTATE,
  since?: string,
): Effect.Effect<string, never, never> => writeFiles(Object.entries(filesOf(mutate, since)))

const PROJECT_A = 'proj-a'
const PROJECT_B = 'proj-b'

const JS_SOURCE = [
  'export const alpha = (value) => {',
  '  const result = value + 1',
  '  return result + value',
  '}',
  '',
].join('\n')

const projectEntriesOf = (
  projects: ReadonlyArray<string>,
  mutate: ReadonlyArray<string>,
  configSince?: string,
): ReadonlyArray<readonly [string, string]> =>
  projects.flatMap((project): ReadonlyArray<readonly [string, string]> => [
    [`${project}/package.json`, '{ "name": "plan-project", "type": "module", "private": true }\n'],
    [`${project}/${CONFIG_FILE}`, configSourceOf(mutate, configSince)],
    [`${project}/src/${project}.js`, JS_SOURCE],
  ])

const writeProjectWorkspace = (
  projects: ReadonlyArray<string>,
  mutate: ReadonlyArray<string>,
  configSince?: string,
): Effect.Effect<string, never, never> => writeFiles(projectEntriesOf(projects, mutate, configSince))

const withChdir = <A, E, R>(directory: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(directory)
      return previous
    }),
    () => effect,
    (previous) => Effect.sync(() => globalThis.process.chdir(previous)),
  )

interface GitCall {
  readonly kind: 'changedSince' | 'head'
  readonly ref: string
  readonly cwd: string
}

interface PlanObservation {
  readonly scope: ShardPlanScope | undefined
  readonly mutantIds: readonly string[]
  readonly projectMutants: Readonly<Record<string, readonly string[]>>
  readonly anyShardSchedulesMutants: boolean
  readonly total: number
  readonly gitCalls: readonly GitCall[]
  readonly failed: boolean
  readonly unresolvedRef: boolean
  readonly outExists: boolean
}

const mutantsByProjectOf = (plan: ShardPlan | undefined): Readonly<Record<string, readonly string[]>> =>
  Option.match(Option.fromUndefinedOr(plan), {
    onNone: (): Readonly<Record<string, readonly string[]>> => ({}),
    onSome: (present) =>
      present.shards
        .flatMap((shard) => shard.projects)
        .reduce<Record<string, readonly string[]>>(
          (accumulated, entry) => ({
            ...accumulated,
            [entry.project]: [...(accumulated[entry.project] ?? []), ...entry.mutants],
          }),
          {},
        ),
  })

const diffResult = (hunks: ReadonlyArray<GitDiffSchema.DiffHunk>): GitDiffSchema.GitDiffResult => ({
  ref: 'HEAD~1',
  base: FAKE_BASE,
  head: FAKE_HEAD,
  hunks: [...hunks],
  untrackedFiles: [],
})

const hunkIn = (file: string, startLine: number, lineCount: number): GitDiffSchema.DiffHunk => ({
  file,
  startLine,
  lineCount,
})

interface PlanRunOptions {
  readonly out: string
  readonly since?: string | undefined
  readonly projects?: ReadonlyArray<string> | undefined
  readonly gitOutcome: (
    ref: string,
  ) => Effect.Effect<GitDiffSchema.GitDiffResult, GitDiffSchema.GitDiffError>
}

const runPlan = (
  root: string,
  options: PlanRunOptions,
): Effect.Effect<PlanObservation, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const calls: GitCall[] = []
    const fakeGit = Layer.succeed(GitDiff.GitDiff, {
      changedSince: (input: GitDiff.GitDiffInput) =>
        Effect.gen(function*() {
          calls.push({ kind: 'changedSince', ref: input.ref, cwd: input.cwd })
          return yield* options.gitOutcome(input.ref)
        }),
      head: (cwd: string) =>
        Effect.sync(() => {
          calls.push({ kind: 'head', ref: '', cwd })
          return 'unused-head'
        }),
    })
    const ports = Layer.mergeAll(Engine.nodePlatformLayer, fakeGit)
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const consoleService = yield* Console.Console
    const exit = yield* withChdir(
      root,
      Engine.planRequest({
        request: {
          targetSeconds: 1,
          maxShards: 4,
          projects: options.projects === undefined ? ['.'] : [...options.projects],
          out: options.out,
          full: false,
          ...(options.since === undefined ? {} : { since: options.since }),
        },
        channel: {
          environment: {
            basePath: root,
            host: { env: environmentFor(root), events: queue },
            console: consoleService,
          },
        },
      }).pipe(Effect.provide(ports), Effect.exit),
    )
    yield* Queue.end(queue)
    const events = [
      ...(yield* Queue.takeAll(queue).pipe(
        Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
      )),
    ]
    const known = events.find((event): event is RunEvent.PlanKnown => S.is(RunEvent.PlanKnown)(event))
    const plan: ShardPlan | undefined = Option.getOrUndefined(
      Option.flatMap(Option.fromUndefinedOr(known), (present) => Option.fromNullishOr(present.shardPlan)),
    )
    const failure = Exit.match(exit, {
      onFailure: (cause) => Cause.findErrorOption(cause),
      onSuccess: () => Option.none<GitDiffSchema.GitDiffError>(),
    })
    return {
      scope: plan?.scope,
      mutantIds: plan === undefined
        ? []
        : plan.shards.flatMap((shard) => shard.projects.flatMap((entry) => entry.mutants)),
      projectMutants: mutantsByProjectOf(plan),
      anyShardSchedulesMutants: plan !== undefined &&
        plan.shards.some((shard) => shard.projects.some((entry) => entry.mutants.length > 0)),
      total: known?.total ?? -1,
      gitCalls: calls,
      failed: Exit.isFailure(exit),
      unresolvedRef: Option.exists(failure, S.is(GitDiffSchema.GitRefUnresolved)),
      outExists: yield* fs.exists(path.join(root, options.out)).pipe(Effect.orElseSucceed(() => false)),
    }
  }).pipe(Effect.provide(filePorts))

const containsAll = (superset: ReadonlyArray<string>, subset: ReadonlyArray<string>): boolean =>
  subset.every((id) => superset.includes(id))

const sameIds = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  containsAll(left, right) && containsAll(right, left)

const strictSubsetOf = (superset: ReadonlyArray<string>, subset: ReadonlyArray<string>): boolean =>
  containsAll(superset, subset) && !sameIds(superset, subset)

const COMMITTER = ['-c', 'user.email=plan@test', '-c', 'user.name=plan'] as const

const gitOutput = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(
      ChildProcess.make('git', args, { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }),
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

const prepareCliRepo = (): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const root = yield* writeWorkspace(FULL_MUTATE)
    yield* requireBinary
    yield* execGit(root, ['init', '-q'])
    yield* execGit(root, [...COMMITTER, 'add', '-A'])
    yield* execGit(root, [...COMMITTER, 'commit', '-q', '-m', 'init'])
    return root
  }).pipe(Effect.orDie, Effect.scoped, Effect.provide(Engine.nodePlatformLayer))

Feature('Planning mutation shards since a git ref')
  .withLayer(Layer.empty)
  .live('the plan drives the real engine with a fake git service, and the built binary refuses an unknown ref')
  .body(({ scenario }) => {
    scenario(
      'A hunk on one target line scopes the plan to diff and schedules only that line',
      Gherkin.Do.pipe(
        Given('a workspace whose unscoped plan and a line-restricted plan are both known')(
          'runs',
          () =>
            Effect.gen(function*() {
              const root = yield* writeWorkspace(FULL_MUTATE)
              const oracleRoot = yield* writeWorkspace(LINE_MUTATE)
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const unscoped = yield* runPlan(root, {
                    out: 'plan-unscoped.json',
                    gitOutcome: () => Effect.succeed(diffResult([])),
                  })
                  const oracle = yield* runPlan(oracleRoot, {
                    out: 'plan-oracle.json',
                    gitOutcome: () => Effect.succeed(diffResult([])),
                  })
                  const diff = yield* runPlan(root, {
                    out: 'plan-diff.json',
                    since: 'HEAD~1',
                    gitOutcome: () => Effect.succeed(diffResult([hunkIn(TARGET_FILE, 3, 1)])),
                  })
                  return { root, unscoped, oracle, diff }
                }),
                Effect.andThen(removeWorkspace(root), removeWorkspace(oracleRoot)),
              )
            }),
        ),
        Then('the plan records the fake base and head, and schedules as many mutants as the line-restricted plan')((
          s,
          expect,
        ) =>
          expect({
            scope: s.runs.diff.scope,
            strictSubsetOfUnscoped: containsAll(s.runs.unscoped.mutantIds, s.runs.diff.mutantIds) &&
              !sameIds(s.runs.unscoped.mutantIds, s.runs.diff.mutantIds),
            scheduled: new Set(s.runs.diff.mutantIds).size,
          }).toEqual({
            scope: { _tag: 'DiffScoped', base: FAKE_BASE, head: FAKE_HEAD },
            strictSubsetOfUnscoped: true,
            scheduled: new Set(s.runs.oracle.mutantIds).size,
          })
        ),
      ),
    )

    scenario(
      'A lockfile hunk widens the plan to full scope and schedules every mutant',
      Gherkin.Do.pipe(
        Given('a workspace planned once unscoped and once with a changed lockfile')(
          'runs',
          () =>
            Effect.gen(function*() {
              const root = yield* writeWorkspace(FULL_MUTATE)
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const unscoped = yield* runPlan(root, {
                    out: 'plan-unscoped.json',
                    gitOutcome: () => Effect.succeed(diffResult([])),
                  })
                  const widened = yield* runPlan(root, {
                    out: 'plan-widened.json',
                    since: 'HEAD~1',
                    gitOutcome: () => Effect.succeed(diffResult([hunkIn('pnpm-lock.yaml', 1, 1)])),
                  })
                  return { root, unscoped, widened }
                }),
                removeWorkspace(root),
              )
            }),
        ),
        Then('the plan records full scope naming the lockfile and schedules every unscoped mutant')((s, expect) =>
          expect({
            scope: s.runs.widened.scope,
            schedulesEverything: sameIds(s.runs.widened.mutantIds, s.runs.unscoped.mutantIds),
            nonEmpty: s.runs.widened.mutantIds.length > 0,
          }).toEqual({
            scope: {
              _tag: 'FullScope',
              base: FAKE_BASE,
              head: FAKE_HEAD,
              reason: 'manifest or lockfile changed: pnpm-lock.yaml',
            },
            schedulesEverything: true,
            nonEmpty: true,
          })
        ),
      ),
    )

    scenario(
      'A hunk outside every mutate pattern scopes to diff and schedules nothing',
      Gherkin.Do.pipe(
        Given('a workspace whose only change since the ref is a document outside the mutate patterns')(
          'runs',
          () =>
            Effect.gen(function*() {
              const root = yield* writeWorkspace(FULL_MUTATE)
              return yield* Effect.ensuring(
                runPlan(root, {
                  out: 'plan-doc-only.json',
                  since: 'HEAD~1',
                  gitOutcome: () => Effect.succeed(diffResult([hunkIn(README_FILE, 1, 1)])),
                }),
                removeWorkspace(root),
              )
            }),
        ),
        Then('the plan is diff scoped and schedules no mutant anywhere')((s, expect) =>
          expect({
            scope: s.runs.scope,
            mutantIds: s.runs.mutantIds,
            anyShardSchedulesMutants: s.runs.anyShardSchedulesMutants,
            total: s.runs.total,
          }).toEqual({
            scope: { _tag: 'DiffScoped', base: FAKE_BASE, head: FAKE_HEAD },
            mutantIds: [],
            anyShardSchedulesMutants: false,
            total: 0,
          })
        ),
      ),
    )

    scenario(
      'A plan without a ref is unscoped and never asks git for a diff',
      Gherkin.Do.pipe(
        Given('a workspace planned without a since ref')(
          'runs',
          () =>
            Effect.gen(function*() {
              const root = yield* writeWorkspace(FULL_MUTATE)
              return yield* Effect.ensuring(
                runPlan(root, { out: 'plan-plain.json', gitOutcome: () => Effect.succeed(diffResult([])) }),
                removeWorkspace(root),
              )
            }),
        ),
        Then('the plan is unscoped and the git service saw no call')((s, expect) =>
          expect({
            scope: s.runs.scope,
            gitCallCount: s.runs.gitCalls.length,
            nonEmpty: s.runs.mutantIds.length > 0,
          }).toEqual({
            scope: { _tag: 'Unscoped' },
            gitCallCount: 0,
            nonEmpty: true,
          })
        ),
      ),
    )

    scenario(
      'An unresolvable ref fails the plan before any plan file is written',
      Gherkin.Do.pipe(
        Given('a workspace prepared for a plan')('root', () => writeWorkspace(FULL_MUTATE)),
        When('the plan runs since a ref the git service cannot resolve')(
          'runs',
          (s) =>
            Effect.ensuring(
              runPlan(s.root, {
                out: 'plan-since.json',
                since: 'no-such-ref',
                gitOutcome: (ref) =>
                  Effect.fail(GitDiffSchema.GitRefUnresolved.make({ ref, detail: 'unknown revision' })),
              }),
              removeWorkspace(s.root),
            ),
        ),
        Then('the plan fails naming the unresolved ref and writes no plan file')((s, expect) =>
          expect({
            failed: s.runs.failed,
            unresolvedRef: s.runs.unresolvedRef,
            outExists: s.runs.outExists,
          }).toEqual({ failed: true, unresolvedRef: true, outExists: false })
        ),
      ),
    )

    scenario(
      'A since ref declared only in the config file scopes the plan to the diff it computes',
      Gherkin.Do.pipe(
        Given('a workspace whose stryker config declares a since ref and a line-restricted plan is also known')(
          'runs',
          () =>
            Effect.gen(function*() {
              const scopedRoot = yield* writeWorkspace(FULL_MUTATE, CONFIG_SINCE)
              const fullRoot = yield* writeWorkspace(FULL_MUTATE)
              const oracleRoot = yield* writeWorkspace(LINE_MUTATE)
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const scoped = yield* runPlan(scopedRoot, {
                    out: 'plan-config-since.json',
                    gitOutcome: () => Effect.succeed(diffResult([hunkIn(TARGET_FILE, 3, 1)])),
                  })
                  const full = yield* runPlan(fullRoot, {
                    out: 'plan-config-full.json',
                    gitOutcome: () => Effect.succeed(diffResult([])),
                  })
                  const oracle = yield* runPlan(oracleRoot, {
                    out: 'plan-config-oracle.json',
                    gitOutcome: () => Effect.succeed(diffResult([])),
                  })
                  return { scoped, full, oracle }
                }),
                Effect.andThen(
                  removeWorkspace(scopedRoot),
                  Effect.andThen(removeWorkspace(fullRoot), removeWorkspace(oracleRoot)),
                ),
              )
            }),
        ),
        Then(
          'the plan is diff scoped at the fake base and head and schedules only the changed line',
        )((s, expect) =>
          expect({
            scope: s.runs.scoped.scope,
            changedSinceCalls: s.runs.scoped.gitCalls.filter((call) => call.kind === 'changedSince').length,
            refs: s.runs.scoped.gitCalls.filter((call) => call.kind === 'changedSince').map((call) => call.ref),
            scheduled: new Set(s.runs.scoped.mutantIds).size,
            narrowerThanFull: new Set(s.runs.scoped.mutantIds).size < new Set(s.runs.full.mutantIds).size,
          }).toEqual({
            scope: { _tag: 'DiffScoped', base: FAKE_BASE, head: FAKE_HEAD },
            changedSinceCalls: 1,
            refs: [CONFIG_SINCE],
            scheduled: new Set(s.runs.oracle.mutantIds).size,
            narrowerThanFull: true,
          })
        ),
      ),
    )

    scenario(
      'A plan made from a config-file since ref is refused by the built CLI at another head',
      Gherkin.Do.pipe(
        Given('a git repository whose stryker config declares a since ref, planned to a fake head')(
          'planned',
          () =>
            Effect.gen(function*() {
              const root = yield* writeWorkspace(FULL_MUTATE, CONFIG_SINCE)
              yield* requireBinary
              yield* execGit(root, ['init', '-q'])
              yield* execGit(root, [...COMMITTER, 'add', '-A'])
              yield* execGit(root, [...COMMITTER, 'commit', '-q', '-m', 'init'])
              const planned = yield* runPlan(root, {
                out: 'plan-config-since.json',
                gitOutcome: () => Effect.succeed(diffResult([hunkIn(TARGET_FILE, 3, 1)])),
              })
              return { root, plan: planned.scope }
            }).pipe(Effect.scoped, Effect.provide(Engine.nodePlatformLayer)),
        ),
        When('the shard runs at the repository head')(
          'ran',
          (s) =>
            Effect.ensuring(
              spawnCli(
                s.planned.root,
                ['run', '--plan', 'plan-config-since.json', '--shard', '1/1', '--out', 'reports/shard-1'],
                'human',
              ),
              removeWorkspace(s.planned.root),
            ).pipe(Effect.scoped, Effect.provide(Engine.nodePlatformLayer)),
        ),
        Then('the run exits with the configuration class and names the plan head')((s, expect) =>
          expect({
            scope: s.planned.plan,
            exitCode: s.ran.exitCode,
            namesPlanHead: s.ran.stderr.includes(FAKE_HEAD),
          }).toEqual({
            scope: { _tag: 'DiffScoped', base: FAKE_BASE, head: FAKE_HEAD },
            exitCode: 2,
            namesPlanHead: true,
          })
        ),
      ),
    )

    scenario(
      'A flag ref over two projects reuses one root diff and scopes only the changed project',
      Gherkin.Do.pipe(
        Given('a workspace with two projects where only one project line changed')(
          'runs',
          () =>
            Effect.gen(function*() {
              const root = yield* writeProjectWorkspace([PROJECT_A, PROJECT_B], ['src/**/*.js'])
              const oracleRoot = yield* writeProjectWorkspace([PROJECT_A], [`src/${PROJECT_A}.js:2-2`])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const unscoped = yield* runPlan(root, {
                    out: 'plan-two-unscoped.json',
                    projects: [PROJECT_A, PROJECT_B],
                    gitOutcome: () => Effect.succeed(diffResult([])),
                  })
                  const diff = yield* runPlan(root, {
                    out: 'plan-two-diff.json',
                    projects: [PROJECT_A, PROJECT_B],
                    since: 'HEAD~1',
                    gitOutcome: () => Effect.succeed(diffResult([hunkIn(`${PROJECT_A}/src/${PROJECT_A}.js`, 2, 1)])),
                  })
                  const oracle = yield* runPlan(oracleRoot, {
                    out: 'plan-two-oracle.json',
                    projects: [PROJECT_A],
                    gitOutcome: () => Effect.succeed(diffResult([])),
                  })
                  return { unscoped, diff, oracle }
                }),
                Effect.andThen(removeWorkspace(root), removeWorkspace(oracleRoot)),
              )
            }),
        ),
        Then(
          'the plan asks git once, scopes the changed project to the changed line and leaves the other project empty',
        )((s, expect) =>
          expect({
            scope: s.runs.diff.scope,
            changedSinceCalls: s.runs.diff.gitCalls.filter((call) => call.kind === 'changedSince').length,
            refs: s.runs.diff.gitCalls.filter((call) => call.kind === 'changedSince').map((call) => call.ref),
            changedScheduled: (s.runs.diff.projectMutants[PROJECT_A] ?? []).length,
            strictSubsetOfUnscoped: strictSubsetOf(
              s.runs.unscoped.projectMutants[PROJECT_A] ?? [],
              s.runs.diff.projectMutants[PROJECT_A] ?? [],
            ),
            unchangedProject: s.runs.diff.projectMutants[PROJECT_B] ?? [],
            unscopedUnchangedNonEmpty: (s.runs.unscoped.projectMutants[PROJECT_B] ?? []).length > 0,
          }).toEqual({
            scope: { _tag: 'DiffScoped', base: FAKE_BASE, head: FAKE_HEAD },
            changedSinceCalls: 1,
            refs: ['HEAD~1'],
            changedScheduled: s.runs.oracle.mutantIds.length,
            strictSubsetOfUnscoped: true,
            unchangedProject: [],
            unscopedUnchangedNonEmpty: true,
          })
        ),
      ),
    )

    scenario(
      'A project config since is ignored when the plan root resolved no since ref',
      Gherkin.Do.pipe(
        Given('a workspace whose project config declares a since ref while the root declares none')(
          'runs',
          () =>
            Effect.gen(function*() {
              const scopedRoot = yield* writeProjectWorkspace([PROJECT_A], ['src/**/*.js'], CONFIG_SINCE)
              const plainRoot = yield* writeProjectWorkspace([PROJECT_A], ['src/**/*.js'])
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const scoped = yield* runPlan(scopedRoot, {
                    out: 'plan-project-since.json',
                    projects: [PROJECT_A],
                    gitOutcome: () => Effect.succeed(diffResult([hunkIn(`${PROJECT_A}/src/${PROJECT_A}.js`, 2, 1)])),
                  })
                  const plain = yield* runPlan(plainRoot, {
                    out: 'plan-project-plain.json',
                    projects: [PROJECT_A],
                    gitOutcome: () => Effect.succeed(diffResult([])),
                  })
                  return { scoped, plain }
                }),
                Effect.andThen(removeWorkspace(scopedRoot), removeWorkspace(plainRoot)),
              )
            }),
        ),
        Then('the plan stays unscoped, never asks git and keeps every project mutant')((s, expect) =>
          expect({
            scope: s.runs.scoped.scope,
            gitCallCount: s.runs.scoped.gitCalls.length,
            scopedScheduled: (s.runs.scoped.projectMutants[PROJECT_A] ?? []).length,
            plainScheduled: (s.runs.plain.projectMutants[PROJECT_A] ?? []).length,
            nonEmpty: (s.runs.scoped.projectMutants[PROJECT_A] ?? []).length > 0,
          }).toEqual({
            scope: { _tag: 'Unscoped' },
            gitCallCount: 0,
            scopedScheduled: (s.runs.plain.projectMutants[PROJECT_A] ?? []).length,
            plainScheduled: (s.runs.plain.projectMutants[PROJECT_A] ?? []).length,
            nonEmpty: true,
          })
        ),
      ),
    )

    scenario(
      'An unknown since ref fails the built CLI plan with the configuration class',
      Gherkin.Do.pipe(
        Given('a git repository holding a committed stryker config')('root', () => prepareCliRepo()),
        When('the plan runs since a ref that does not exist')(
          'ran',
          (s) =>
            Effect.ensuring(
              spawnCli(
                s.root,
                ['plan', '--target-seconds', '1', '--out', 'plan.json', '--since', 'no-such-ref'],
                'human',
              ),
              removeWorkspace(s.root),
            ).pipe(Effect.scoped, Effect.provide(Engine.nodePlatformLayer)),
        ),
        Then('the process exits with the configuration class and stderr names the ref')((s, expect) =>
          expect({
            exitCode: s.ran.exitCode,
            namesRef: s.ran.stderr.includes('no-such-ref'),
          }).toEqual({ exitCode: 2, namesRef: true })
        ),
      ),
    )
  })
