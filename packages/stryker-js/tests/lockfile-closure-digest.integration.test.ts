import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import { parseDocument, stringify } from 'yaml'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

type FilePorts = FileSystem.FileSystem | Path.Path

const FIXTURES = new URL('./__fixtures__/lockfile-closure/', import.meta.url)

const LIVE_LOCKFILE = new URL('../../../pnpm-lock.yaml', import.meta.url)

const MUTATED_PROJECTS = [
  'packages/stryker-js',
  'packages/stryker-js-typescript-checker',
  'packages/stryker-js-vitest-runner',
  'test/e2e-core',
] as const

const ORACLE_PROJECTS = ['a', 'b'] as const

const ORACLE_TEMPLATE_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'a/package.json',
  'b/package.json',
  'c/package.json',
]

const INSTALL_SETTING_LINES = [
  'hoist: false',
  "hoistPattern:\n  - '*eslint*'",
  "publicHoistPattern: '*types*'",
  'nodeLinker: hoisted',
  'shamefullyHoist: true',
] as const

const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'

const ROOT_MANIFEST = '{ "name": "lockfile-closure-root", "private": true, "packageManager": "pnpm@11.27.0" }\n'

const FALLBACK_LINE = /^Run-inputs digest fell back to the whole lockfile .*: (\w+) \(/

type Json = S.Json

type Workspace = Readonly<Record<string, string>>

type SecondRun = 'keptVerdicts' | 'refusedForRunInputs' | 'other'

interface RunOutcome {
  readonly reuse: RunEvent.ReuseReported | undefined
  readonly fallbacks: ReadonlyArray<string>
}

interface ProjectOutcome {
  readonly second: SecondRun
  readonly fallbacks: ReadonlyArray<string>
}

const outcomeOf = (second: SecondRun, fallbacks: ReadonlyArray<string> = []): ProjectOutcome => ({
  second,
  fallbacks,
})

const everyProject = (
  projects: ReadonlyArray<string>,
  outcome: ProjectOutcome,
): Readonly<Record<string, ProjectOutcome>> => Object.fromEntries(projects.map((project) => [project, outcome]))

const secondRunOf = (reuse: RunEvent.ReuseReported | undefined): SecondRun =>
  reuse !== undefined && reuse.reused > 0 && reuse.ran === 0
    ? 'keptVerdicts'
    : reuse !== undefined && reuse.reused === 0 && reuse.refused.runInputsChanged === reuse.ran && reuse.ran > 0
    ? 'refusedForRunInputs'
    : 'other'

const fallbackReasonsOf = (logs: ReadonlyArray<string>): ReadonlyArray<string> =>
  logs.flatMap((text) => Option.toArray(Option.fromNullishOr(FALLBACK_LINE.exec(text)?.[1])))

const capturingLogger = (logs: Array<string>): Layer.Layer<never> =>
  Logger.layer([
    Logger.make((entry) => {
      logs.push([entry.message].flat().map(String).join(' '))
    }),
  ])

const fixtureTextOf = (relative: string): Effect.Effect<string, never, FilePorts> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    return yield* fs.readFileString(yield* pathService.fromFileUrl(new URL(relative, FIXTURES)))
  }).pipe(Effect.orDie)

const liveLockfileText: Effect.Effect<string, never, FilePorts> = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  return yield* fs.readFileString(yield* pathService.fromFileUrl(LIVE_LOCKFILE))
}).pipe(Effect.orDie)

const projectManifestOf = (project: string): string =>
  `{ "name": "${project.replaceAll('/', '-')}", "private": true }\n`

const repositoryWorkspaceOf = (lockfile: string): Workspace =>
  Object.fromEntries<string>([
    ['pnpm-lock.yaml', lockfile],
    ['package.json', ROOT_MANIFEST],
    ...MUTATED_PROJECTS.map((
      project,
    ): readonly [string, string] => [`${project}/package.json`, projectManifestOf(project)]),
  ])

const singleProjectWorkspaceOf = (lockfileName: string, lockfile: string): Workspace => ({
  [lockfileName]: lockfile,
  'package.json': ROOT_MANIFEST,
  'a/package.json': projectManifestOf('a'),
})

const oracleWorkspaceOf = (variant: string): Effect.Effect<Workspace, never, FilePorts> =>
  Effect.gen(function*() {
    const template = yield* Effect.forEach(
      ORACLE_TEMPLATE_FILES,
      (file) => Effect.map(fixtureTextOf(`oracle/workspace/${file}`), (text) => [file, text] as const),
    )
    const lockfile = yield* fixtureTextOf(`oracle/locks/${variant}.pnpm-lock.yaml`)
    return Object.fromEntries<string>([...template, ['pnpm-lock.yaml', lockfile]])
  })

const withFileEdited = (workspace: Workspace, file: string, edit: (text: string) => string): Workspace => ({
  ...workspace,
  [file]: edit(workspace[file] ?? ''),
})

const reversedKeysOf = (value: Json): Json =>
  Array.isArray(value)
    ? value.map(reversedKeysOf)
    : Option.match(Option.liftPredicate(value, (candidate) => S.is(S.Record(S.String, S.Json))(candidate)), {
      onSome: (record): Json =>
        Object.fromEntries(Object.entries(record).reverse().map(([key, entry]) => [key, reversedKeysOf(entry)])),
      onNone: () => value,
    })

const reserializedInReverseOf = (text: string): Effect.Effect<string, never, never> =>
  S.decodeUnknownEffect(S.Json)(parseDocument(text).toJS()).pipe(
    Effect.map((parsed) => stringify(reversedKeysOf(parsed))),
    Effect.orDie,
  )

const writeWorkspace = (root: string, workspace: Workspace): Effect.Effect<void, never, FilePorts> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    yield* Effect.forEach(Object.entries(workspace), ([file, content]) => {
      const target = pathService.join(root, file)
      return fs.makeDirectory(pathService.dirname(target), { recursive: true }).pipe(
        Effect.andThen(fs.writeFileString(target, content)),
      )
    }, { discard: true })
  }).pipe(Effect.orDie)

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

const optionsOf = (project: string): Options.PartialStrykerOptions => ({
  testRunner: 'command',
  commandRunner: { command: 'true' },
  coverageAnalysis: 'off',
  reporters: [],
  mutate: ['src/**/*.ts'],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${project}/reports/main.json`,
})

const runOf = (project: string): Effect.Effect<RunOutcome, never, never> =>
  Effect.gen(function*() {
    const logs: Array<string> = []
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(project), queue), ports),
      ports,
    )
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(project), targetMutatePatterns: undefined })
      .pipe(Effect.provide(Layer.merge(runLayer, capturingLogger(logs))), Effect.scoped, Effect.exit)
    const events = [
      ...(yield* Queue.end(queue).pipe(
        Effect.andThen(Queue.takeAll(queue)),
        Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
      )),
    ]
    return {
      reuse: events.find((event): event is RunEvent.ReuseReported => S.is(RunEvent.ReuseReported)(event)),
      fallbacks: fallbackReasonsOf(logs),
    }
  })

const stagedRunsOf = <A>(
  workspace: Workspace,
  projects: ReadonlyArray<string>,
  runs: (root: string) => Effect.Effect<A, never, FilePorts>,
): Effect.Effect<A, never, FilePorts> =>
  Effect.scoped(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'lockfile-closure-' })
      yield* writeWorkspace(root, {
        ...workspace,
        ...Object.fromEntries(projects.map((project) => [`${project}/src/math.ts`, SOURCE])),
      })
      return yield* runs(root)
    }),
  ).pipe(Effect.orDie)

const secondRunOutcomesOf = (
  before: Workspace,
  after: Workspace,
  projects: ReadonlyArray<string>,
): Effect.Effect<Readonly<Record<string, ProjectOutcome>>, never, FilePorts> =>
  stagedRunsOf(before, projects, (root) =>
    Effect.gen(function*() {
      const pathService = yield* Path.Path
      const first = yield* Effect.forEach(projects, (project) => runOf(pathService.join(root, project)))
      yield* writeWorkspace(root, after)
      const second = yield* Effect.forEach(projects, (project) => runOf(pathService.join(root, project)))
      return Object.fromEntries(
        Arr.zipWith(Arr.zip(projects, first), second, ([project, earlier], later) => [
          project,
          outcomeOf(secondRunOf(later.reuse), Arr.dedupe([...earlier.fallbacks, ...later.fallbacks])),
        ]),
      )
    }))

const firstRunFallbacksOf = (
  workspace: Workspace,
  projects: ReadonlyArray<string>,
): Effect.Effect<Readonly<Record<string, ReadonlyArray<string>>>, never, FilePorts> =>
  stagedRunsOf(workspace, projects, (root) =>
    Effect.gen(function*() {
      const pathService = yield* Path.Path
      const runs = yield* Effect.forEach(projects, (project) => runOf(pathService.join(root, project)))
      return Object.fromEntries(Arr.zipWith(projects, runs, (project, run) => [project, Arr.dedupe(run.fallbacks)]))
    }))

Feature('Keeping saved verdicts across lockfile edits outside a project dependencies')
  .withLayer(filePorts)
  .live('the scenarios drive the real engine over staged workspaces on the host filesystem')
  .body(({ scenario }) => {
    scenario(
      'A lockfile edit that adds a package no mutated project depends on keeps every mutated project verdicts',
      Gherkin.Do.pipe(
        Given('the repository lockfile before and after a new test package was added')('locks', () =>
          Effect.all({
            before: fixtureTextOf('real/pnpm-lock.56426ca94.yaml'),
            after: fixtureTextOf('real/pnpm-lock.ec9dcf63c.yaml'),
          })),
        When('each mutated project runs once on the older lockfile and again on the newer one')(
          'outcomes',
          (s) =>
            secondRunOutcomesOf(
              repositoryWorkspaceOf(s.locks.before),
              repositoryWorkspaceOf(s.locks.after),
              MUTATED_PROJECTS,
            ),
        ),
        Then('every mutated project reuses its saved verdicts and no run falls back to the whole lockfile')((
          s,
          expect,
        ) => expect(s.outcomes).toEqual(everyProject(MUTATED_PROJECTS, outcomeOf('keptVerdicts')))),
      ),
    )

    scenario(
      'A dependency upgrade in one project re-tests that project and keeps the other project verdicts',
      Gherkin.Do.pipe(
        Given('a workspace lockfile and its successor where only project a upgrades a dependency')(
          'workspaces',
          () => Effect.all({ before: oracleWorkspaceOf('base'), after: oracleWorkspaceOf('x-bumped') }),
        ),
        When('projects a and b run once on each lockfile')(
          'outcomes',
          (s) => secondRunOutcomesOf(s.workspaces.before, s.workspaces.after, ORACLE_PROJECTS),
        ),
        Then('project a re-tests its mutants and project b reuses its verdicts')((s, expect) =>
          expect(s.outcomes).toEqual({ a: outcomeOf('refusedForRunInputs'), b: outcomeOf('keptVerdicts') })
        ),
      ),
    )

    scenario(
      'A re-packed local tarball re-tests only the project that depends on it',
      Gherkin.Do.pipe(
        Given('a workspace lockfile and its successor where the tarball b installs was re-packed')(
          'workspaces',
          () => Effect.all({ before: oracleWorkspaceOf('base'), after: oracleWorkspaceOf('tgz-repacked') }),
        ),
        When('projects a and b run once on each lockfile')(
          'outcomes',
          (s) => secondRunOutcomesOf(s.workspaces.before, s.workspaces.after, ORACLE_PROJECTS),
        ),
        Then('project b re-tests its mutants and project a reuses its verdicts')((s, expect) =>
          expect(s.outcomes).toEqual({ a: outcomeOf('keptVerdicts'), b: outcomeOf('refusedForRunInputs') })
        ),
      ),
    )

    scenario(
      'A root development dependency upgrade re-tests every project',
      Gherkin.Do.pipe(
        Given('a workspace lockfile and its successor where the root importer upgrades a dev dependency')(
          'workspaces',
          () => Effect.all({ before: oracleWorkspaceOf('base'), after: oracleWorkspaceOf('root-dev-bumped') }),
        ),
        When('projects a and b run once on each lockfile')(
          'outcomes',
          (s) => secondRunOutcomesOf(s.workspaces.before, s.workspaces.after, ORACLE_PROJECTS),
        ),
        Then('both projects re-test their mutants')((s, expect) =>
          expect(s.outcomes).toEqual(everyProject(ORACLE_PROJECTS, outcomeOf('refusedForRunInputs')))
        ),
      ),
    )

    scenario(
      'Every lockfile key form pnpm writes resolves without falling back to the whole lockfile',
      Gherkin.Do.pipe(
        Given('the oracle workspace with aliased, peer-suffixed, patched, tarball and linked dependencies')(
          'workspace',
          () => oracleWorkspaceOf('base'),
        ),
        When('every oracle project runs twice on the same lockfile')(
          'outcomes',
          (s) => secondRunOutcomesOf(s.workspace, s.workspace, ['a', 'b', 'c']),
        ),
        Then('every project reuses its verdicts and no run falls back to the whole lockfile')((s, expect) =>
          expect(s.outcomes).toEqual(everyProject(['a', 'b', 'c'], outcomeOf('keptVerdicts')))
        ),
      ),
    )

    scenario(
      'Re-serializing the lockfile in another key order keeps every project verdicts',
      Gherkin.Do.pipe(
        Given('the oracle lockfile and the same lockfile written with every key order reversed')(
          'workspaces',
          () =>
            Effect.gen(function*() {
              const base = yield* oracleWorkspaceOf('base')
              const reversed = yield* reserializedInReverseOf(base['pnpm-lock.yaml'] ?? '')
              return { before: base, after: { ...base, 'pnpm-lock.yaml': reversed } }
            }),
        ),
        When('projects a and b run once on each lockfile')(
          'outcomes',
          (s) => secondRunOutcomesOf(s.workspaces.before, s.workspaces.after, ORACLE_PROJECTS),
        ),
        Then('both projects reuse their verdicts')((s, expect) =>
          expect(s.outcomes).toEqual(everyProject(ORACLE_PROJECTS, outcomeOf('keptVerdicts')))
        ),
      ),
    )

    scenario(
      'Any edit to a package-lock.json re-tests its project without a fallback warning',
      Gherkin.Do.pipe(
        Given('an npm project whose package-lock.json gains an unrelated package')('workspaces', () =>
          Effect.succeed({
            before: singleProjectWorkspaceOf(
              'package-lock.json',
              '{ "name": "root", "lockfileVersion": 3, "requires": true, "packages": {} }\n',
            ),
            after: singleProjectWorkspaceOf(
              'package-lock.json',
              '{ "name": "root", "lockfileVersion": 3, "requires": true, "packages": { "node_modules/x": { "version": "1.0.0" } } }\n',
            ),
          })),
        When('the project runs once on each lockfile')(
          'outcomes',
          (s) => secondRunOutcomesOf(s.workspaces.before, s.workspaces.after, ['a']),
        ),
        Then('the project re-tests its mutants and nothing warns')((s, expect) =>
          expect(s.outcomes).toEqual({ a: outcomeOf('refusedForRunInputs') })
        ),
      ),
    )

    scenario(
      'An unparseable pnpm lockfile is digested whole and every run names the reason',
      Gherkin.Do.pipe(
        Given('a pnpm-lock.yaml that cannot be parsed, edited into different unparseable text')(
          'workspaces',
          () =>
            Effect.succeed({
              before: singleProjectWorkspaceOf('pnpm-lock.yaml', 'importers: [\n'),
              after: singleProjectWorkspaceOf('pnpm-lock.yaml', 'importers: [[\n'),
            }),
        ),
        When('the project runs once on each lockfile')(
          'outcomes',
          (s) => secondRunOutcomesOf(s.workspaces.before, s.workspaces.after, ['a']),
        ),
        Then('the project re-tests its mutants and the only fallback reason is LockfileUnparseable')((s, expect) =>
          expect(s.outcomes).toEqual({ a: outcomeOf('refusedForRunInputs', ['LockfileUnparseable']) })
        ),
      ),
    )

    scenario(
      'A pnpm lockfile with no importer for the project is digested whole and every run names the reason',
      Gherkin.Do.pipe(
        Given('a valid pnpm-lock.yaml that records only the root importer, edited elsewhere')(
          'workspaces',
          () =>
            Effect.succeed({
              before: singleProjectWorkspaceOf('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .: {}\n"),
              after: singleProjectWorkspaceOf(
                'pnpm-lock.yaml',
                "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\nimporters:\n  .: {}\n",
              ),
            }),
        ),
        When('the project runs once on each lockfile')(
          'outcomes',
          (s) => secondRunOutcomesOf(s.workspaces.before, s.workspaces.after, ['a']),
        ),
        Then('the project re-tests its mutants and the only fallback reason is ImporterMissing')((s, expect) =>
          expect(s.outcomes).toEqual({ a: outcomeOf('refusedForRunInputs', ['ImporterMissing']) })
        ),
      ),
    )

    scenario(
      'Changing any hoisting setting in pnpm-workspace.yaml re-tests every project',
      Gherkin.Do.pipe(
        Given('the oracle workspace and, for each hoisting setting in turn, the workspace with it set')(
          'workspaces',
          () =>
            Effect.map(oracleWorkspaceOf('base'), (base) => ({
              base,
              edited: INSTALL_SETTING_LINES.map((line) =>
                withFileEdited(base, 'pnpm-workspace.yaml', (text) => `${text}${line}\n`)
              ),
            })),
        ),
        When('projects a and b run once on the base workspace and again with each setting')(
          'outcomes',
          (s) =>
            Effect.forEach(
              s.workspaces.edited,
              (edited) => secondRunOutcomesOf(s.workspaces.base, edited, ORACLE_PROJECTS),
            ),
        ),
        Then('both projects re-test their mutants for every setting')((s, expect) =>
          expect(s.outcomes).toEqual(
            INSTALL_SETTING_LINES.map(() => everyProject(ORACLE_PROJECTS, outcomeOf('refusedForRunInputs'))),
          )
        ),
      ),
    )

    scenario(
      'An unparseable pnpm-workspace.yaml is digested whole and names the reason',
      Gherkin.Do.pipe(
        Given('the oracle workspace and the same workspace with an unparseable pnpm-workspace.yaml')(
          'workspaces',
          () =>
            Effect.map(oracleWorkspaceOf('base'), (base) => ({
              before: base,
              after: { ...base, 'pnpm-workspace.yaml': 'packages: [\n' },
            })),
        ),
        When('projects a and b run once on each workspace')(
          'outcomes',
          (s) => secondRunOutcomesOf(s.workspaces.before, s.workspaces.after, ORACLE_PROJECTS),
        ),
        Then('both projects re-test their mutants and the only fallback reason is InstallSettingsUnparseable')((
          s,
          expect,
        ) =>
          expect(s.outcomes).toEqual(
            everyProject(ORACLE_PROJECTS, outcomeOf('refusedForRunInputs', ['InstallSettingsUnparseable'])),
          )
        ),
      ),
    )

    scenario(
      'A packageManager bump in the root manifest re-tests every project',
      Gherkin.Do.pipe(
        Given('the oracle workspace and the same workspace whose root manifest pins the next pnpm')(
          'workspaces',
          () =>
            Effect.map(oracleWorkspaceOf('base'), (base) => ({
              before: base,
              after: withFileEdited(base, 'package.json', (text) => text.replace('pnpm@11.27.0', 'pnpm@11.28.0')),
            })),
        ),
        When('projects a and b run once on each workspace')(
          'outcomes',
          (s) => secondRunOutcomesOf(s.workspaces.before, s.workspaces.after, ORACLE_PROJECTS),
        ),
        Then('both projects re-test their mutants')((s, expect) =>
          expect(s.outcomes).toEqual(everyProject(ORACLE_PROJECTS, outcomeOf('refusedForRunInputs')))
        ),
      ),
    )

    scenario(
      'The repository lockfile is digested by closure for every mutated project',
      Gherkin.Do.pipe(
        Given('the repository pnpm-lock.yaml as it stands in this checkout')('lockfile', () => liveLockfileText),
        When('each mutated project runs once against it')(
          'fallbacks',
          (s) => firstRunFallbacksOf(repositoryWorkspaceOf(s.lockfile), MUTATED_PROJECTS),
        ),
        Then(
          'no project falls back to the whole lockfile; a listed reason code means pnpm wrote a ref form the grammar misses: regenerate the oracle with `pnpm --filter @systemfsoftware/stryker-js fixtures:lockfile-oracle`, then fix the grammar its pins expose',
        )((s, expect) =>
          expect(s.fallbacks).toEqual(Object.fromEntries(MUTATED_PROJECTS.map((project) => [project, []])))
        ),
      ),
    )
  })
