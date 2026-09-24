import { NodeFileSystem, NodePath, NodeStdio } from '@effect/platform-node'
import { And, Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine, RunEvent, Worker } from '@systemfsoftware/stryker-js'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import { expect } from 'vitest'
import { nodeVmPlatformLayer } from '../src/drivers/node.js'

const Feature = makeFeature({ it, layer })

const FRAMEWORK_FIXTURES = `${globalThis.process.cwd()}/tests/__fixtures__/frameworks`

const pluginUrlOf = (moduleName: string): string =>
  globalThis.process.getBuiltinModule('node:url').pathToFileURL(`${FRAMEWORK_FIXTURES}/${moduleName}`).href

const NEVER_SPAWN = 'a child process was spawned for an in-memory run'

const workerCanary = Layer.succeed(
  Worker.WorkerLauncher,
  Worker.WorkerLauncher.of({
    spawn: () => Effect.die(new Error(NEVER_SPAWN)),
  }),
)

const spawnerCanary = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() => Effect.die(new Error(NEVER_SPAWN))),
)

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const neverSpawnPorts: Layer.Layer<Engine.EnginePorts> = Layer.mergeAll(
  filePorts,
  NodeStdio.layer,
  workerCanary,
  spawnerCanary,
  nodeVmPlatformLayer,
)

interface Workspace {
  readonly directory: string
  readonly pluginUrls: readonly string[]
  readonly mutatePatterns: readonly string[]
}

const workspaceOf = (
  directory: string,
  pluginUrls: readonly string[],
  mutatePatterns: readonly string[],
): Workspace => ({ directory, pluginUrls, mutatePatterns })

const PACKAGE_SOURCE = '{ "type": "commonjs" }\n'
const MATH_SOURCE = 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n'
const TEST_SOURCE = [
  'const assert = require("node:assert");',
  'const { add } = require("../src/math.js");',
  'assert.strictEqual(add(1, 2), 3);',
].join('\n')
const SVELTE_SOURCE = '<template><p id="greeting">hello</p></template>\n'
const FIXTURE_SOURCE = '<script>\nfunction add(a, b) {\n  return a + b;\n}\n</script>\n'
const INSTALLED_WORKSPACE_PACKAGE = [
  '{',
  '  "type": "commonjs",',
  '  "dependencies": {',
  '    "@systemfsoftware/stryker-js-svelte": "0.0.0",',
  '    "fixture-framework": "1.0.0"',
  '  }',
  '}',
  '',
].join('\n')
const INSTALLED_SVELTE_MANIFEST = [
  '{',
  '  "name": "@systemfsoftware/stryker-js-svelte",',
  '  "version": "0.0.0",',
  '  "strykerFramework": { "extensions": [".svelte"] }',
  '}',
  '',
].join('\n')
const INSTALLED_FIXTURE_MANIFEST = [
  '{',
  '  "name": "fixture-framework",',
  '  "version": "1.0.0",',
  '  "type": "module",',
  '  "exports": { ".": "./index.mjs" },',
  '  "strykerFramework": { "extensions": [".fixture"] }',
  '}',
  '',
].join('\n')
const INSTALLED_FIXTURE_ENTRY = [
  'const parseFixture = (rawContent, context) => {',
  '  const open = rawContent.indexOf("<script>")',
  '  const close = rawContent.indexOf("</script>")',
  '  const start = open + "<script>".length',
  '  return {',
  '    kind: "Parsed",',
  '    value: {',
  '      formatId: "fixture",',
  '      rawContent,',
  '      regions: [',
  '        {',
  '          start,',
  '          end: close,',
  '          isExpression: false,',
  "          scriptAst: context.parseScript(rawContent.slice(start, close), 'js'),",
  '        },',
  '      ],',
  '    },',
  '  }',
  '}',
  '',
  'export const strykerFrameworks = [',
  '  {',
  '    kind: "Framework",',
  '    name: "fixture-format",',
  '    claim: {',
  '      formatId: "fixture",',
  '      extensions: [".fixture"],',
  '      language: "fixture",',
  '      ownerVersion: "1.0.0",',
  '      contractVersion: "1",',
  '    },',
  '    parse: parseFixture,',
  '    transform: (document) => document,',
  '    print: (document) => document.rawContent,',
  '    disableTypeChecks: (rawContent) => ({ kind: "Parsed", value: rawContent }),',
  '  },',
  ']',
  '',
].join('\n')

const writeWorkspace = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    yield* Effect.forEach(
      files,
      ([name, content]) =>
        Effect.gen(function*() {
          const target = path.join(directory, name)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    return directory
  }).pipe(Effect.orDie)

const removeWorkspace = (directory: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.orDie(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })),
  )

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: 'framework-run-integration',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

const incrementalFileOf = (directory: string): string => `${directory}/reports/stryker-incremental.json`

interface RunObservation {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly events: ReadonlyArray<RunEvent.RunEvent>
  readonly incrementalState: string
}

const incrementalStateOf = (directory: string): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(incrementalFileOf(directory))).pipe(
    Effect.orElseSucceed(() => ''),
  )

const runOver = (workspace: Workspace): Effect.Effect<RunObservation, never, never> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(workspace.directory), queue), neverSpawnPorts),
      neverSpawnPorts,
    )
    const exit = yield* Engine.mutationTestCell
      .run({
        cliOptions: {
          testRunner: 'vm',
          plugins: [...workspace.pluginUrls],
          reporters: [],
          checkers: [],
          testFiles: ['test/**/*.mjs'],
          mutate: [...workspace.mutatePatterns],
          cleanTempDir: 'always',
          incremental: true,
          incrementalFile: incrementalFileOf(workspace.directory),
        },
        targetMutatePatterns: undefined,
      })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events = yield* Queue.takeAll(queue).pipe(Effect.orElseSucceed(() => []))
    const incrementalState = yield* incrementalStateOf(workspace.directory)
    return { exit, events: [...events], incrementalState }
  }).pipe(
    Effect.ensuring(Effect.provide(removeWorkspace(workspace.directory), filePorts)),
    Effect.provide(filePorts),
  )

Feature('Framework plugins joining a mutation run')
  .withLayer(Layer.empty)
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'A file no loaded framework claims is skipped and the run still completes',
      Gherkin.Do.pipe(
        Given('a workspace whose files to mutate include a component no framework claims')(
          'workspace',
          () =>
            writeWorkspace([
              ['package.json', INSTALLED_WORKSPACE_PACKAGE],
              ['src/math.js', MATH_SOURCE],
              ['src/widget.svelte', SVELTE_SOURCE],
              ['test/sample.test.mjs', TEST_SOURCE],
              ['node_modules/@systemfsoftware/stryker-js-svelte/package.json', INSTALLED_SVELTE_MANIFEST],
              ['node_modules/fixture-framework/package.json', INSTALLED_FIXTURE_MANIFEST],
              ['node_modules/fixture-framework/index.mjs', INSTALLED_FIXTURE_ENTRY],
            ]).pipe(
              Effect.map((directory) => workspaceOf(directory, [], ['src/**/*.js', 'src/**/*.svelte'])),
              Effect.provide(filePorts),
            ),
        ),
        When('a mutation run executes over the workspace')(
          'observation',
          (s) => runOver(s.workspace),
        ),
        Then('the run completes and reports a verdict')((s) => {
          expect(Exit.isSuccess(s.observation.exit)).toBe(true)
          expect(
            s.observation.events.filter((event): event is RunEvent.VerdictReached =>
              S.is(RunEvent.VerdictReached)(event)
            ),
          ).toHaveLength(1)
        }),
        And('the skipped-files report names the component and points to the missing framework and the plugins setting')(
          (s) => {
            const skipped = s.observation.events.find(
              (event): event is RunEvent.SkippedReported => S.is(RunEvent.SkippedReported)(event),
            )
            const row = skipped?.files.find((file) => file.file.endsWith('widget.svelte'))
            expect(row?.extension).toBe('.svelte')
            expect(row?.reason).toContain('@systemfsoftware/stryker-js-svelte')
            expect(row?.reason).toContain('Add @systemfsoftware/stryker-js-svelte to "plugins"')
            const verdict = s.observation.events.find(
              (event): event is RunEvent.VerdictReached => S.is(RunEvent.VerdictReached)(event),
            )
            expect(verdict?.mutants.some((mutant) => mutant.file.endsWith('.svelte'))).toBe(false)
          },
        ),
      ),
    )

    scenario(
      'A framework missing its peer dependency refuses the run before any file is touched',
      Gherkin.Do.pipe(
        Given('a workspace configured with a framework whose peer package is not installed')(
          'workspace',
          () =>
            writeWorkspace([]).pipe(
              Effect.map((directory) => workspaceOf(directory, [pluginUrlOf('peer-missing.fixture.mjs')], [])),
              Effect.provide(filePorts),
            ),
        ),
        When('a mutation run executes over the workspace')(
          'observation',
          (s) => runOver(s.workspace),
        ),
        Then('the run refuses with a configuration exit code naming the missing peer')((s) => {
          expect(Exit.isFailure(s.observation.exit)).toBe(true)
          const failure = s.observation.events.find((event): event is RunEvent.RunFailed =>
            S.is(RunEvent.RunFailed)(event)
          )
          expect(failure?.reason).toBe('PeerMissing')
          expect(failure?.code).toBe(2)
          expect(failure?.error).toContain('peer-missing')
          expect(failure?.remediation).toContain('peer dependency')
        }),
        And('the run stopped while loading, with no verdict and no files examined')((s) => {
          const phases = s.observation.events
            .filter((event): event is RunEvent.PhaseEntered => S.is(RunEvent.PhaseEntered)(event))
            .map((phase) => phase.phase)
          expect(phases).toEqual(['prepare'])
          expect(s.observation.events.some((event) => S.is(RunEvent.VerdictReached)(event))).toBe(false)
          expect(s.observation.events.some((event) => S.is(RunEvent.SkippedReported)(event))).toBe(false)
        }),
      ),
    )

    scenario(
      'A configured framework claims its file type and yields mutants from its component',
      Gherkin.Do.pipe(
        Given('a workspace whose custom component is claimed by the configured framework')(
          'workspace',
          () =>
            writeWorkspace([
              ['package.json', PACKAGE_SOURCE],
              ['src/math.js', MATH_SOURCE],
              ['src/widget.fixture', FIXTURE_SOURCE],
              ['test/sample.test.mjs', TEST_SOURCE],
            ]).pipe(
              Effect.map((directory) =>
                workspaceOf(
                  directory,
                  [pluginUrlOf('valid-framework.fixture.mjs')],
                  ['src/**/*.fixture', 'src/**/*.js'],
                )
              ),
              Effect.provide(filePorts),
            ),
        ),
        When('a mutation run executes over the workspace')(
          'observation',
          (s) => runOver(s.workspace),
        ),
        Then('the resolved-formats report names the custom file type with the fixture module as its owner')((s) => {
          const formats = s.observation.events.find(
            (event): event is RunEvent.FormatRegistryResolved => S.is(RunEvent.FormatRegistryResolved)(event),
          )
          const row = formats?.rows.find((candidate) => candidate.extension === '.fixture')
          expect(row?.ownerModule).toBe(pluginUrlOf('valid-framework.fixture.mjs'))
          expect(row?.formatId).toBe('fixture')
          expect(row?.language).toBe('fixture')
        }),
        And('a mutant from the claimed component is exercised and reported')((s) => {
          expect(Exit.isSuccess(s.observation.exit)).toBe(true)
          const tested = s.observation.events.filter(
            (event): event is RunEvent.RunMutantTested => S.is(RunEvent.RunMutantTested)(event),
          )
          const fromClaimed = tested.find((mutant) => mutant.file.endsWith('widget.fixture'))
          expect(fromClaimed).toBeDefined()
          expect(fromClaimed?.status).toBe('Survived')
        }),
        And('the remembered run state labels the component with its framework and records who claimed it')((s) =>
          Effect.gen(function*() {
            const state = yield* S.decodeEffect(S.fromJsonString(Engine.IncrementalReportSchema))(
              s.observation.incrementalState,
            )
            expect(state.files['src/widget.fixture']?.language).toBe('fixture')
            expect(state.files['src/widget.fixture']?.formatIdentity).toStrictEqual({
              formatId: 'fixture',
              ownerModule: pluginUrlOf('valid-framework.fixture.mjs'),
              ownerVersion: '1.0.0',
            })
            expect(state.files['src/math.js']?.language).toBe('javascript')
          })
        ),
      ),
    )

    scenario(
      'When two configured frameworks claim the same file type the one listed first owns it',
      Gherkin.Do.pipe(
        Given('a workspace listing a rival framework before the fixture framework, both claiming the same file type')(
          'workspace',
          () =>
            writeWorkspace([]).pipe(
              Effect.map((directory) =>
                workspaceOf(
                  directory,
                  [pluginUrlOf('rival-framework.fixture.mjs'), pluginUrlOf('valid-framework.fixture.mjs')],
                  [],
                )
              ),
              Effect.provide(filePorts),
            ),
        ),
        When('a mutation run executes over the workspace')(
          'observation',
          (s) => runOver(s.workspace),
        ),
        Then('the resolved-formats report gives the shared file type to the first listed framework')((s) => {
          const formats = s.observation.events.find(
            (event): event is RunEvent.FormatRegistryResolved => S.is(RunEvent.FormatRegistryResolved)(event),
          )
          const row = formats?.rows.find((candidate) => candidate.extension === '.fixture')
          expect(row?.ownerModule).toBe(pluginUrlOf('rival-framework.fixture.mjs'))
          expect(formats?.rows.find((candidate) => candidate.extension === '.ts')?.ownerModule).toBe(
            '@systemfsoftware/stryker-js-instrumenter',
          )
        }),
        And('the plugins report names the later framework and the rival script claim as shadowed')((s) => {
          const plugins = s.observation.events.find(
            (event): event is RunEvent.PluginsReported => S.is(RunEvent.PluginsReported)(event),
          )
          expect(plugins?.shadowings).toStrictEqual([
            {
              extension: '.ts',
              winner: '@systemfsoftware/stryker-js-instrumenter',
              loser: pluginUrlOf('rival-framework.fixture.mjs'),
            },
            {
              extension: '.fixture',
              winner: pluginUrlOf('rival-framework.fixture.mjs'),
              loser: pluginUrlOf('valid-framework.fixture.mjs'),
            },
          ])
        }),
      ),
    )

    scenario(
      'A plugin module that crashes while loading refuses the run as an internal failure',
      Gherkin.Do.pipe(
        Given('a workspace configured with a plugin module that crashes while it is imported')(
          'workspace',
          () =>
            writeWorkspace([]).pipe(
              Effect.map((directory) => workspaceOf(directory, [pluginUrlOf('throws-on-import.fixture.mjs')], [])),
              Effect.provide(filePorts),
            ),
        ),
        When('a mutation run executes over the workspace')(
          'observation',
          (s) => runOver(s.workspace),
        ),
        Then('the run refuses with an internal-error exit code naming the failing module')((s) => {
          expect(Exit.isFailure(s.observation.exit)).toBe(true)
          const failure = s.observation.events.find((event): event is RunEvent.RunFailed =>
            S.is(RunEvent.RunFailed)(event)
          )
          expect(failure?.reason).toBe('ImportFailed')
          expect(failure?.code).toBe(4)
          expect(failure?.error).toContain('throws-on-import')
        }),
      ),
    )

    scenario(
      'A plugin whose framework lacks a required hook refuses the run as a configuration error',
      Gherkin.Do.pipe(
        Given('a workspace configured with a plugin whose framework has no parse hook')(
          'workspace',
          () =>
            writeWorkspace([]).pipe(
              Effect.map((directory) => workspaceOf(directory, [pluginUrlOf('malformed.fixture.mjs')], [])),
              Effect.provide(filePorts),
            ),
        ),
        When('a mutation run executes over the workspace')(
          'observation',
          (s) => runOver(s.workspace),
        ),
        Then('the run refuses with a configuration exit code naming the plugin module')((s) => {
          expect(Exit.isFailure(s.observation.exit)).toBe(true)
          const failure = s.observation.events.find((event): event is RunEvent.RunFailed =>
            S.is(RunEvent.RunFailed)(event)
          )
          expect(failure?.reason).toBe('InvalidContribution')
          expect(failure?.code).toBe(2)
          expect(failure?.error).toContain('malformed')
        }),
      ),
    )

    scenario(
      'A framework whose peer is present but unrecognized refuses the run before any file is touched',
      Gherkin.Do.pipe(
        Given('a workspace configured with a framework whose peer package is not what it needs')(
          'workspace',
          () =>
            writeWorkspace([]).pipe(
              Effect.map((directory) => workspaceOf(directory, [pluginUrlOf('peer-unrecognized.fixture.mjs')], [])),
              Effect.provide(filePorts),
            ),
        ),
        When('a mutation run executes over the workspace')(
          'observation',
          (s) => runOver(s.workspace),
        ),
        Then('the run refuses with a configuration exit code naming the unrecognized peer')((s) => {
          expect(Exit.isFailure(s.observation.exit)).toBe(true)
          const failure = s.observation.events.find((event): event is RunEvent.RunFailed =>
            S.is(RunEvent.RunFailed)(event)
          )
          expect(failure?.reason).toBe('PeerUnrecognized')
          expect(failure?.code).toBe(2)
          expect(failure?.error).toContain('peer-unrecognized')
          expect(failure?.remediation).toContain('recognizes')
        }),
        And('the run stopped while loading, with no verdict and no files examined')((s) => {
          const phases = s.observation.events
            .filter((event): event is RunEvent.PhaseEntered => S.is(RunEvent.PhaseEntered)(event))
            .map((phase) => phase.phase)
          expect(phases).toEqual(['prepare'])
          expect(s.observation.events.some((event) => S.is(RunEvent.VerdictReached)(event))).toBe(false)
          expect(s.observation.events.some((event) => S.is(RunEvent.SkippedReported)(event))).toBe(false)
        }),
      ),
    )

    scenario(
      'A framework named by its package joins the run from the workspace install',
      Gherkin.Do.pipe(
        Given('a workspace whose component framework is installed under its package name')(
          'workspace',
          () =>
            writeWorkspace([
              ['package.json', INSTALLED_WORKSPACE_PACKAGE],
              ['src/widget.fixture', FIXTURE_SOURCE],
              ['test/sample.test.mjs', TEST_SOURCE],
              ['node_modules/fixture-framework/package.json', INSTALLED_FIXTURE_MANIFEST],
              ['node_modules/fixture-framework/index.mjs', INSTALLED_FIXTURE_ENTRY],
            ]).pipe(
              Effect.map((directory) => workspaceOf(directory, ['fixture-framework'], ['src/**/*.fixture'])),
              Effect.provide(filePorts),
            ),
        ),
        When('a mutation run executes over the workspace')(
          'observation',
          (s) => runOver(s.workspace),
        ),
        Then('the resolved-formats report gives the component type to the named package')((s) => {
          const formats = s.observation.events.find(
            (event): event is RunEvent.FormatRegistryResolved => S.is(RunEvent.FormatRegistryResolved)(event),
          )
          const row = formats?.rows.find((candidate) => candidate.extension === '.fixture')
          expect(row?.formatId).toBe('fixture')
          expect(row?.language).toBe('fixture')
          expect(row?.ownerModule).toBe('fixture-framework')
        }),
      ),
    )

    scenario(
      'An installed framework that is not configured is named by the skip report',
      Gherkin.Do.pipe(
        Given('a workspace whose component framework is installed but left out of the plugin list')(
          'workspace',
          () =>
            writeWorkspace([
              ['package.json', INSTALLED_WORKSPACE_PACKAGE],
              ['src/widget.fixture', FIXTURE_SOURCE],
              ['test/sample.test.mjs', TEST_SOURCE],
              ['node_modules/fixture-framework/package.json', INSTALLED_FIXTURE_MANIFEST],
              ['node_modules/fixture-framework/index.mjs', INSTALLED_FIXTURE_ENTRY],
            ]).pipe(
              Effect.map((directory) => workspaceOf(directory, [], ['src/**/*.fixture'])),
              Effect.provide(filePorts),
            ),
        ),
        When('a mutation run executes over the workspace')(
          'observation',
          (s) => runOver(s.workspace),
        ),
        Then('the run completes and the skip report tells the reader which package to add')((s) => {
          expect(Exit.isFailure(s.observation.exit)).toBe(true)
          const skipped = s.observation.events.find(
            (event): event is RunEvent.SkippedReported => S.is(RunEvent.SkippedReported)(event),
          )
          const row = skipped?.files.find((file) => file.file.endsWith('widget.fixture'))
          expect(row?.extension).toBe('.fixture')
          expect(row?.reason).toBe(
            'No loaded framework claims ".fixture". Add fixture-framework to "plugins" to instrument it.',
          )
        }),
      ),
    )
  })
