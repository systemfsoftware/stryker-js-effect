import { NodeFileSystem, NodePath } from '@effect/platform-node'
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
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

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

const configSourceOf = (mutate: ReadonlyArray<string>): string =>
  `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ${JSON.stringify(mutate)},
  coverageAnalysis: 'off',
  checkers: [],
  reporters: [],
  cleanTempDir: 'always',
}
`

const filesOf = (mutate: ReadonlyArray<string>): Readonly<Record<string, string>> => ({
  'package.json': '{ "name": "plan-since-consumer", "type": "module", "private": true }\n',
  [CONFIG_FILE]: configSourceOf(mutate),
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

const writeWorkspace = (
  mutate: ReadonlyArray<string> = FULL_MUTATE,
): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory())
    yield* Effect.forEach(
      Object.entries(filesOf(mutate)),
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

const writeConfig = (
  root: string,
  mutate: ReadonlyArray<string>,
): Effect.Effect<void, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* fs.writeFileString(`${root}/${CONFIG_FILE}`, configSourceOf(mutate))
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const removeWorkspace = (root: string): Effect.Effect<void, never, never> =>
  Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true }))).pipe(
    Effect.provide(filePorts),
  )

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
  readonly shardCount: number
  readonly anyShardSchedulesMutants: boolean
  readonly total: number
  readonly gitCalls: readonly GitCall[]
  readonly failed: boolean
  readonly unresolvedRef: boolean
  readonly outExists: boolean
}

const diffResult = (
  hunks: ReadonlyArray<GitDiffSchema.DiffHunk>,
  untrackedFiles: ReadonlyArray<string> = [],
): GitDiffSchema.GitDiffResult => ({
  ref: 'HEAD~1',
  base: FAKE_BASE,
  head: FAKE_HEAD,
  hunks: [...hunks],
  untrackedFiles: [...untrackedFiles],
})

const hunkIn = (file: string, startLine: number, lineCount: number): GitDiffSchema.DiffHunk => ({
  file,
  startLine,
  lineCount,
})

interface PlanRunOptions {
  readonly out: string
  readonly since?: string | undefined
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
          projects: ['.'],
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
      shardCount: plan?.shards.length ?? 0,
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

const sameIds = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean => {
  const unique = new Set(left)
  const other = new Set(right)
  return unique.size === other.size && [...unique].every((id) => other.has(id))
}

Feature('Planning mutation shards since a git ref')
  .withLayer(Layer.empty)
  .live('the plan drives the real engine with a fake git service, so no git process is spawned')
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
  })
