import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import type { ShardPlan, ShardPlanScope } from '@systemfsoftware/stryker-js-cli-contract'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import { removeWorkspace } from './__fixtures__/check-cost-workspace.fixture.js'
import { type CliOutcome, decodePlan, requireBinary, spawnCli } from './__fixtures__/shard-cli.fixture.js'

const Feature = makeFeature({ it })

const TARGET_FILE = 'src/target.ts'
const OTHER_FILE = 'src/other.ts'
const README_FILE = 'docs/readme.md'
const CONFIG_FILE = 'stryker.config.mjs'
const MANIFEST_FILE = 'package.json'
const PLAN_FILE = 'plan.json'
const UNRESOLVED_REF = 'no-such-ref'

const TARGET_SOURCE = [
  'export const target = (value: number): number => {',
  '  const doubled = value * 2',
  '  return doubled + 1',
  '}',
  '',
].join('\n')

const CHANGED_TARGET_SOURCE = TARGET_SOURCE.replace('return doubled + 1', 'return doubled + 2')

const OTHER_SOURCE = [
  'export const other = (value: number): number => {',
  '  const tripled = value * 3',
  '  return tripled - 1',
  '}',
  '',
].join('\n')

const README_SOURCE = '# readme\n'

const CHANGED_README_SOURCE = '# readme changed\n'

const MANIFEST_SOURCE = '{ "name": "plan-since-consumer", "type": "module", "private": true }\n'

const CHANGED_MANIFEST_SOURCE =
  '{ "name": "plan-since-consumer", "type": "module", "private": true, "description": "changed" }\n'

const FULL_MUTATE = ['src/**/*.ts'] as const
const LINE_MUTATE = ['src/target.ts:3-3'] as const

const PROJECT_A = 'proj-a'
const PROJECT_B = 'proj-b'
const PROJECT_MUTATE = ['src/**/*.js'] as const

const JS_SOURCE = [
  'export const alpha = (value) => {',
  '  const result = value + 1',
  '  return result + value',
  '}',
  '',
].join('\n')

const CHANGED_JS_SOURCE = JS_SOURCE.replace('value + 1', 'value + 2')

const COMMITTER = ['-c', 'user.email=plan@test', '-c', 'user.name=plan'] as const

const CONFIG_SINCE_TWO = 'HEAD~2'
const CONFIG_SINCE_ONE = 'HEAD~1'

const SHA_PATTERN = /^[0-9a-f]{40}$/

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

const workspaceFilesOf = (
  mutate: ReadonlyArray<string>,
  since?: string,
): ReadonlyArray<readonly [string, string]> => [
  [MANIFEST_FILE, MANIFEST_SOURCE],
  [CONFIG_FILE, configSourceOf(mutate, since)],
  [TARGET_FILE, TARGET_SOURCE],
  [OTHER_FILE, OTHER_SOURCE],
  [README_FILE, README_SOURCE],
]

const projectFilesOf = (
  projects: ReadonlyArray<string>,
  mutate: ReadonlyArray<string>,
  configSince?: string,
): ReadonlyArray<readonly [string, string]> =>
  projects.flatMap((project): ReadonlyArray<readonly [string, string]> => [
    [`${project}/${MANIFEST_FILE}`, MANIFEST_SOURCE],
    [`${project}/${CONFIG_FILE}`, configSourceOf(mutate, configSince)],
    [`${project}/src/${project}.js`, JS_SOURCE],
  ])

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

const writeWorkspace = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-plan-since-' }))
    yield* Effect.forEach(files, ([file, content]) => writeFile(root, file, content), { discard: true })
    return root
  }).pipe(Effect.orDie)

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

const commitAll = (
  root: string,
  message: string,
): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function*() {
    yield* execGit(root, [...COMMITTER, 'add', '-A'])
    yield* execGit(root, [...COMMITTER, 'commit', '-q', '-m', message])
  })

const headOf = (root: string): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  gitOutput(root, ['rev-parse', 'HEAD'])

const cliWorkspace = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    yield* requireBinary
    return yield* writeWorkspace(files)
  })

const gitWorkspace = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<
  string,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function*() {
    const root = yield* cliWorkspace(files)
    yield* execGit(root, ['init', '-q'])
    yield* commitAll(root, 'base')
    return root
  })

const readPlan = (
  root: string,
  out: string,
): Effect.Effect<ShardPlan, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(root, out))
    return Option.getOrThrowWith(
      decodePlan(text),
      () => new Error(`the planner wrote no decodable ShardPlan to ${out}`),
    )
  }).pipe(Effect.orDie)

const planTo = (
  root: string,
  out: string,
  extra: ReadonlyArray<string> = [],
): Effect.Effect<
  { readonly ran: CliOutcome; readonly plan: ShardPlan },
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function*() {
    const ran = yield* spawnCli(root, ['plan', '--target-seconds', '1', '--out', out, ...extra], 'human')
    return { ran, plan: yield* readPlan(root, out) }
  })

const runShardIn = (
  root: string,
  planFile: string,
): Effect.Effect<CliOutcome, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  spawnCli(root, ['run', '--plan', planFile, '--shard', '1/1', '--out', 'reports/shard-1'], 'human')

const scheduledIds = (plan: ShardPlan): ReadonlyArray<string> =>
  plan.shards.flatMap((shard) => shard.projects.flatMap((entry) => entry.mutants))

const projectMutants = (plan: ShardPlan, project: string): ReadonlyArray<string> =>
  plan.shards.flatMap((shard) =>
    shard.projects.filter((entry) => entry.project === project).flatMap((entry) => entry.mutants)
  )

const sorted = (ids: ReadonlyArray<string>): ReadonlyArray<string> => [...ids].sort()

const sameIds = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  sorted(left).join(',') === sorted(right).join(',')

interface ScopeView {
  readonly base: string
  readonly head: string
  readonly reason?: string | undefined
}

const scopeTagOf = (scope: ShardPlanScope): string =>
  Match.value(scope).pipe(
    Match.tag('DiffScoped', () => 'DiffScoped'),
    Match.tag('FullScope', () => 'FullScope'),
    Match.tag('Unscoped', () => 'Unscoped'),
    Match.exhaustive,
  )

const diffScopeOf = (scope: ShardPlanScope): ScopeView | undefined =>
  Match.value(scope).pipe(
    Match.tag('DiffScoped', (scoped): ScopeView => ({ base: scoped.base, head: scoped.head })),
    Match.orElse(() => undefined),
  )

const fullScopeOf = (scope: ShardPlanScope): ScopeView | undefined =>
  Match.value(scope).pipe(
    Match.tag('FullScope', (full): ScopeView => ({ base: full.base, head: full.head, reason: full.reason })),
    Match.orElse(() => undefined),
  )

Feature('Planning mutation shards since a git ref', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary plans against a real temporary git repository')
  .body(({ scenario }) => {
    scenario(
      'A hunk on one target line scopes the plan to diff and schedules only that line',
      Gherkin.Do.pipe(
        Given('a repository whose target line changed since its base commit')('planned', () =>
          Effect.gen(function*() {
            const root = yield* gitWorkspace(workspaceFilesOf(FULL_MUTATE))
            const base = yield* headOf(root)
            yield* writeFile(root, TARGET_FILE, CHANGED_TARGET_SOURCE)
            yield* commitAll(root, 'change the target line')
            const oracleRoot = yield* writeWorkspace(workspaceFilesOf(LINE_MUTATE))
            yield* writeFile(oracleRoot, TARGET_FILE, CHANGED_TARGET_SOURCE)
            return yield* Effect.ensuring(
              Effect.gen(function*() {
                const unscoped = yield* planTo(root, 'plan-unscoped.json')
                const scoped = yield* planTo(root, PLAN_FILE, ['--since', base])
                const oracle = yield* planTo(oracleRoot, 'plan-oracle.json')
                return { base, unscoped, scoped, oracle }
              }),
              Effect.andThen(removeWorkspace(root), removeWorkspace(oracleRoot)),
            )
          })),
        Then(
          'the plan names the base commit as its base, scopes to the diff and matches the line-restricted plan',
        )((s, expect) => {
          const scope = s.planned.scoped.plan.scope
          const diff = diffScopeOf(scope)
          const scopedIds = scheduledIds(s.planned.scoped.plan)
          const unscopedIds = scheduledIds(s.planned.unscoped.plan)
          const oracleIds = scheduledIds(s.planned.oracle.plan)
          return expect({
            unscopedExit: s.planned.unscoped.ran.exitCode,
            scopedExit: s.planned.scoped.ran.exitCode,
            oracleExit: s.planned.oracle.ran.exitCode,
            scopeTag: scopeTagOf(scope),
            baseIsTheBaseCommit: diff?.base === s.planned.base,
            headIsACommit: diff !== undefined && SHA_PATTERN.test(diff.head),
            schedulesFewerThanUnscoped: scopedIds.length < unscopedIds.length,
            everyScheduledIdIsUnscoped: scopedIds.every((id) => unscopedIds.includes(id)),
            schedulesAsManyAsTheLineRestrictedPlan: scopedIds.length === oracleIds.length,
            nonEmpty: scopedIds.length > 0,
          }).toEqual({
            unscopedExit: 0,
            scopedExit: 0,
            oracleExit: 0,
            scopeTag: 'DiffScoped',
            baseIsTheBaseCommit: true,
            headIsACommit: true,
            schedulesFewerThanUnscoped: true,
            everyScheduledIdIsUnscoped: true,
            schedulesAsManyAsTheLineRestrictedPlan: true,
            nonEmpty: true,
          })
        }),
      ),
    )

    scenario(
      'A manifest hunk widens the plan to full scope and schedules every unscoped mutant',
      Gherkin.Do.pipe(
        Given('a repository whose manifest changed since its base commit')('planned', () =>
          Effect.gen(function*() {
            const root = yield* gitWorkspace(workspaceFilesOf(FULL_MUTATE))
            const base = yield* headOf(root)
            yield* writeFile(root, MANIFEST_FILE, CHANGED_MANIFEST_SOURCE)
            yield* commitAll(root, 'change the manifest')
            return yield* Effect.ensuring(
              Effect.gen(function*() {
                const unscoped = yield* planTo(root, 'plan-unscoped.json')
                const widened = yield* planTo(root, PLAN_FILE, ['--since', base])
                return { base, unscoped, widened }
              }),
              removeWorkspace(root),
            )
          })),
        Then('the plan records full scope naming the manifest and schedules every unscoped mutant')((s, expect) => {
          const scope = s.planned.widened.plan.scope
          const full = fullScopeOf(scope)
          const widenedIds = scheduledIds(s.planned.widened.plan)
          const unscopedIds = scheduledIds(s.planned.unscoped.plan)
          return expect({
            unscopedExit: s.planned.unscoped.ran.exitCode,
            widenedExit: s.planned.widened.ran.exitCode,
            scopeTag: scopeTagOf(scope),
            baseIsTheBaseCommit: full?.base === s.planned.base,
            headIsACommit: full !== undefined && SHA_PATTERN.test(full.head),
            reason: full?.reason ?? '',
            schedulesEverything: sameIds(widenedIds, unscopedIds),
            nonEmpty: widenedIds.length > 0,
          }).toEqual({
            unscopedExit: 0,
            widenedExit: 0,
            scopeTag: 'FullScope',
            baseIsTheBaseCommit: true,
            headIsACommit: true,
            reason: 'manifest or lockfile changed: package.json',
            schedulesEverything: true,
            nonEmpty: true,
          })
        }),
      ),
    )

    scenario(
      'A change outside every mutate pattern scopes to diff and schedules nothing',
      Gherkin.Do.pipe(
        Given('a repository whose only change since the base commit is a document')(
          'planned',
          () =>
            Effect.gen(function*() {
              const root = yield* gitWorkspace(workspaceFilesOf(FULL_MUTATE))
              const base = yield* headOf(root)
              yield* writeFile(root, README_FILE, CHANGED_README_SOURCE)
              yield* commitAll(root, 'change the readme')
              const planned = yield* Effect.ensuring(
                planTo(root, PLAN_FILE, ['--since', base]),
                removeWorkspace(root),
              )
              return { base, planned }
            }),
        ),
        Then('the plan is diff scoped and schedules no mutant anywhere')((s, expect) => {
          const scope = s.planned.planned.plan.scope
          const diff = diffScopeOf(scope)
          return expect({
            exit: s.planned.planned.ran.exitCode,
            scopeTag: scopeTagOf(scope),
            baseIsTheBaseCommit: diff?.base === s.planned.base,
            headIsACommit: diff !== undefined && SHA_PATTERN.test(diff.head),
            scheduled: scheduledIds(s.planned.planned.plan).length,
          }).toEqual({
            exit: 0,
            scopeTag: 'DiffScoped',
            baseIsTheBaseCommit: true,
            headIsACommit: true,
            scheduled: 0,
          })
        }),
      ),
    )

    scenario(
      'A plan without a ref is unscoped and needs no git repository at all',
      Gherkin.Do.pipe(
        Given('a project that is not a git repository')('planned', () =>
          Effect.gen(function*() {
            const root = yield* cliWorkspace(workspaceFilesOf(FULL_MUTATE))
            return yield* Effect.ensuring(planTo(root, PLAN_FILE), removeWorkspace(root))
          })),
        Then('the plan is unscoped and schedules every mutant')((s, expect) =>
          expect({
            exit: s.planned.ran.exitCode,
            scopeTag: scopeTagOf(s.planned.plan.scope),
            nonEmpty: scheduledIds(s.planned.plan).length > 0,
          }).toEqual({ exit: 0, scopeTag: 'Unscoped', nonEmpty: true })
        ),
      ),
    )

    scenario(
      'An unresolvable ref fails the plan before any plan file is written',
      Gherkin.Do.pipe(
        Given('a repository holding a committed stryker project')(
          'root',
          () => gitWorkspace(workspaceFilesOf(FULL_MUTATE)),
        ),
        When('the plan runs since a ref the repository does not have')(
          'ran',
          (s) =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const ran = yield* spawnCli(
                s.root,
                ['plan', '--target-seconds', '1', '--out', PLAN_FILE, '--since', UNRESOLVED_REF],
                'human',
              )
              return { ran, outExists: yield* fs.exists(path.join(s.root, PLAN_FILE)) }
            }).pipe(Effect.ensuring(removeWorkspace(s.root))),
        ),
        Then('the process exits with the configuration class, names the ref and writes no plan file')((s, expect) =>
          expect({
            exitCode: s.ran.ran.exitCode,
            namesRef: s.ran.ran.stderr.includes(UNRESOLVED_REF),
            outExists: s.ran.outExists,
          }).toEqual({ exitCode: 2, namesRef: true, outExists: false })
        ),
      ),
    )

    scenario(
      'A since ref declared only in the config file scopes the plan to the diff it computes',
      Gherkin.Do.pipe(
        Given('a repository whose stryker config declares a since ref, with a line-restricted plan also known')(
          'planned',
          () =>
            Effect.gen(function*() {
              const root = yield* gitWorkspace(workspaceFilesOf(FULL_MUTATE, CONFIG_SINCE_TWO))
              yield* writeFile(root, README_FILE, CHANGED_README_SOURCE)
              yield* commitAll(root, 'change the readme')
              yield* writeFile(root, TARGET_FILE, CHANGED_TARGET_SOURCE)
              yield* commitAll(root, 'change the target line')
              const oracleRoot = yield* writeWorkspace(workspaceFilesOf(LINE_MUTATE))
              yield* writeFile(oracleRoot, TARGET_FILE, CHANGED_TARGET_SOURCE)
              const fullRoot = yield* writeWorkspace(workspaceFilesOf(FULL_MUTATE))
              yield* writeFile(fullRoot, TARGET_FILE, CHANGED_TARGET_SOURCE)
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const scoped = yield* planTo(root, PLAN_FILE)
                  const oracle = yield* planTo(oracleRoot, 'plan-oracle.json')
                  const full = yield* planTo(fullRoot, 'plan-full.json')
                  return { scoped, oracle, full }
                }),
                Effect.andThen(
                  removeWorkspace(root),
                  Effect.andThen(removeWorkspace(oracleRoot), removeWorkspace(fullRoot)),
                ),
              )
            }),
        ),
        Then('the plan is diff scoped and schedules as many mutants as the line-restricted plan')((s, expect) => {
          const scope = s.planned.scoped.plan.scope
          const diff = diffScopeOf(scope)
          const scopedIds = scheduledIds(s.planned.scoped.plan)
          const oracleIds = scheduledIds(s.planned.oracle.plan)
          const fullIds = scheduledIds(s.planned.full.plan)
          return expect({
            scopedExit: s.planned.scoped.ran.exitCode,
            scopeTag: scopeTagOf(scope),
            headIsACommit: diff !== undefined && SHA_PATTERN.test(diff.head),
            schedulesAsManyAsTheLineRestrictedPlan: scopedIds.length === oracleIds.length,
            narrowerThanFull: scopedIds.length > 0 && scopedIds.length < fullIds.length,
          }).toEqual({
            scopedExit: 0,
            scopeTag: 'DiffScoped',
            headIsACommit: true,
            schedulesAsManyAsTheLineRestrictedPlan: true,
            narrowerThanFull: true,
          })
        }),
      ),
    )

    scenario(
      'A plan made from a config-file ref is refused once the repository has moved on',
      Gherkin.Do.pipe(
        Given('a git repository whose stryker config declares a since ref, planned at one commit')(
          'planned',
          () =>
            Effect.gen(function*() {
              const root = yield* gitWorkspace(workspaceFilesOf(FULL_MUTATE, CONFIG_SINCE_ONE))
              yield* writeFile(root, TARGET_FILE, CHANGED_TARGET_SOURCE)
              yield* commitAll(root, 'change the target line')
              const planned = yield* planTo(root, 'plan-config-since.json')
              yield* writeFile(root, README_FILE, CHANGED_README_SOURCE)
              yield* commitAll(root, 'move the head')
              const movedHead = yield* headOf(root)
              return { root, planned, movedHead }
            }),
        ),
        When('the shard runs at the moved commit')(
          'ran',
          (s) =>
            Effect.ensuring(
              runShardIn(s.planned.root, 'plan-config-since.json'),
              removeWorkspace(s.planned.root),
            ),
        ),
        Then('the run exits with the configuration class and names the plan head and the moved head')((s, expect) => {
          const scope = s.planned.planned.plan.scope
          const diff = diffScopeOf(scope)
          return expect({
            exitCode: s.ran.exitCode,
            scopeTag: scopeTagOf(scope),
            headIsACommit: diff !== undefined && SHA_PATTERN.test(diff.head),
            planHeadDiffersFromTheMovedHead: diff !== undefined && diff.head !== s.planned.movedHead,
            namesThePlanHead: diff !== undefined && s.ran.stderr.includes(diff.head),
            namesTheMovedHead: s.ran.stderr.includes(s.planned.movedHead),
          }).toEqual({
            exitCode: 2,
            scopeTag: 'DiffScoped',
            headIsACommit: true,
            planHeadDiffersFromTheMovedHead: true,
            namesThePlanHead: true,
            namesTheMovedHead: true,
          })
        }),
      ),
    )

    scenario(
      'A flag ref over two projects scopes only the changed project to the changed line',
      Gherkin.Do.pipe(
        Given('a repository with two projects where only one project line changed')(
          'planned',
          () =>
            Effect.gen(function*() {
              const root = yield* gitWorkspace(projectFilesOf([PROJECT_A, PROJECT_B], PROJECT_MUTATE))
              const base = yield* headOf(root)
              yield* writeFile(root, `${PROJECT_A}/src/${PROJECT_A}.js`, CHANGED_JS_SOURCE)
              yield* commitAll(root, 'change the first project line')
              const oracleRoot = yield* writeWorkspace(projectFilesOf([PROJECT_A], [`src/${PROJECT_A}.js:2-2`]))
              yield* writeFile(oracleRoot, `${PROJECT_A}/src/${PROJECT_A}.js`, CHANGED_JS_SOURCE)
              return yield* Effect.ensuring(
                Effect.gen(function*() {
                  const projects = `${PROJECT_A},${PROJECT_B}`
                  const unscoped = yield* planTo(root, 'plan-unscoped.json', ['--projects', projects])
                  const scoped = yield* planTo(root, PLAN_FILE, ['--projects', projects, '--since', base])
                  const oracle = yield* planTo(oracleRoot, 'plan-oracle.json', ['--projects', PROJECT_A])
                  return { base, unscoped, scoped, oracle }
                }),
                Effect.andThen(removeWorkspace(root), removeWorkspace(oracleRoot)),
              )
            }),
        ),
        Then('the plan scopes the changed project to the changed line and leaves the other project empty')((
          s,
          expect,
        ) => {
          const scope = s.planned.scoped.plan.scope
          const diff = diffScopeOf(scope)
          const scopedA = projectMutants(s.planned.scoped.plan, PROJECT_A)
          const unscopedA = projectMutants(s.planned.unscoped.plan, PROJECT_A)
          const oracleA = projectMutants(s.planned.oracle.plan, PROJECT_A)
          const scopedB = projectMutants(s.planned.scoped.plan, PROJECT_B)
          return expect({
            scopedExit: s.planned.scoped.ran.exitCode,
            scopeTag: scopeTagOf(scope),
            baseIsTheBaseCommit: diff?.base === s.planned.base,
            changedProjectSchedulesAsManyAsTheLineRestrictedPlan: scopedA.length === oracleA.length,
            changedProjectIsNarrower: scopedA.length > 0 && scopedA.length < unscopedA.length,
            everyScheduledIdIsUnscoped: scopedA.every((id) => unscopedA.includes(id)),
            unchangedProject: scopedB,
          }).toEqual({
            scopedExit: 0,
            scopeTag: 'DiffScoped',
            baseIsTheBaseCommit: true,
            changedProjectSchedulesAsManyAsTheLineRestrictedPlan: true,
            changedProjectIsNarrower: true,
            everyScheduledIdIsUnscoped: true,
            unchangedProject: [],
          })
        }),
      ),
    )

    scenario(
      'A project config since is ignored when the plan root resolved no since ref',
      Gherkin.Do.pipe(
        Given('a project whose config declares a since ref while its directory is not a git repository')(
          'planned',
          () =>
            Effect.gen(function*() {
              const root = yield* cliWorkspace(projectFilesOf([PROJECT_A], PROJECT_MUTATE, CONFIG_SINCE_ONE))
              return yield* Effect.ensuring(
                planTo(root, PLAN_FILE, ['--projects', PROJECT_A]),
                removeWorkspace(root),
              )
            }),
        ),
        Then('the plan stays unscoped and keeps every project mutant')((s, expect) =>
          expect({
            exit: s.planned.ran.exitCode,
            scopeTag: scopeTagOf(s.planned.plan.scope),
            scheduled: projectMutants(s.planned.plan, PROJECT_A).length > 0,
          }).toEqual({ exit: 0, scopeTag: 'Unscoped', scheduled: true })
        ),
      ),
    )

    scenario(
      'An unknown since ref fails the plan with the configuration class',
      Gherkin.Do.pipe(
        Given('a git repository holding a committed stryker config')(
          'root',
          () => gitWorkspace(workspaceFilesOf(FULL_MUTATE)),
        ),
        When('the plan runs since a ref that does not exist')(
          'ran',
          (s) =>
            Effect.ensuring(
              spawnCli(
                s.root,
                ['plan', '--target-seconds', '1', '--out', PLAN_FILE, '--since', UNRESOLVED_REF],
                'human',
              ),
              removeWorkspace(s.root),
            ),
        ),
        Then('the process exits with the configuration class and stderr names the ref')((s, expect) =>
          expect({
            exitCode: s.ran.exitCode,
            namesRef: s.ran.stderr.includes(UNRESOLVED_REF),
          }).toEqual({ exitCode: 2, namesRef: true })
        ),
      ),
    )
  })
