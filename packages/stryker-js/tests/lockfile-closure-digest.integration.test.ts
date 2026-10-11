import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

type FilePorts = FileSystem.FileSystem | Path.Path

const FIXTURES = new URL('./__fixtures__/lockfile-closure/', import.meta.url)

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

const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'

const ROOT_MANIFEST = '{ "name": "lockfile-closure-root", "private": true, "packageManager": "pnpm@11.27.0" }\n'

type Workspace = Readonly<Record<string, string>>

type SecondRun = 'keptVerdicts' | 'refusedForRunInputs' | 'other'

const secondRunOf = (reuse: RunEvent.ReuseReported | undefined): SecondRun =>
  reuse !== undefined && reuse.reused > 0 && reuse.ran === 0
    ? 'keptVerdicts'
    : reuse !== undefined && reuse.reused === 0 && reuse.refused.runInputsChanged === reuse.ran && reuse.ran > 0
    ? 'refusedForRunInputs'
    : 'other'

const fixtureTextOf = (relative: string): Effect.Effect<string, never, FilePorts> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    return yield* fs.readFileString(yield* pathService.fromFileUrl(new URL(relative, FIXTURES)))
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

const oracleWorkspaceOf = (variant: string): Effect.Effect<Workspace, never, FilePorts> =>
  Effect.gen(function*() {
    const template = yield* Effect.forEach(
      ORACLE_TEMPLATE_FILES,
      (file) => Effect.map(fixtureTextOf(`oracle/workspace/${file}`), (text) => [file, text] as const),
    )
    const lockfile = yield* fixtureTextOf(`oracle/locks/${variant}.pnpm-lock.yaml`)
    return Object.fromEntries<string>([...template, ['pnpm-lock.yaml', lockfile]])
  })

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

const reuseOfRun = (project: string): Effect.Effect<RunEvent.ReuseReported | undefined, never, never> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(project), queue), ports),
      ports,
    )
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(project), targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events = [
      ...(yield* Queue.end(queue).pipe(
        Effect.andThen(Queue.takeAll(queue)),
        Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
      )),
    ]
    return events.find((event): event is RunEvent.ReuseReported => S.is(RunEvent.ReuseReported)(event))
  })

const secondRunReuseOf = (
  before: Workspace,
  after: Workspace,
  projects: ReadonlyArray<string>,
): Effect.Effect<Readonly<Record<string, SecondRun>>, never, FilePorts> =>
  Effect.scoped(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'lockfile-closure-' })
      yield* writeWorkspace(root, {
        ...before,
        ...Object.fromEntries(projects.map((project) => [`${project}/src/math.ts`, SOURCE])),
      })
      yield* Effect.forEach(projects, (project) => reuseOfRun(pathService.join(root, project)), { discard: true })
      yield* writeWorkspace(root, after)
      const outcomes = yield* Effect.forEach(projects, (project) =>
        Effect.map(reuseOfRun(pathService.join(root, project)), (reuse) =>
          [project, secondRunOf(reuse)] as const))
      return Object.fromEntries(outcomes)
    }),
  ).pipe(Effect.orDie)

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
          'reuse',
          (s) =>
            secondRunReuseOf(
              repositoryWorkspaceOf(s.locks.before),
              repositoryWorkspaceOf(s.locks.after),
              MUTATED_PROJECTS,
            ),
        ),
        Then('every mutated project reuses its saved verdicts on the second run')((s, expect) =>
          expect(s.reuse).toEqual(Object.fromEntries(MUTATED_PROJECTS.map((project) => [project, 'keptVerdicts'])))
        ),
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
          'reuse',
          (s) => secondRunReuseOf(s.workspaces.before, s.workspaces.after, ORACLE_PROJECTS),
        ),
        Then('project a re-tests its mutants and project b reuses its verdicts')((s, expect) =>
          expect(s.reuse).toEqual({ a: 'refusedForRunInputs', b: 'keptVerdicts' })
        ),
      ),
    )
  })
