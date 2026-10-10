import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as Stdio from 'effect/Stdio'

const Feature = makeFeature({ it })

const TEMP_DIR_NAME = '.stryker-tmp'

type FixtureFiles = Readonly<Record<string, string>>

interface ProjectFixture {
  readonly root: string
  readonly project: string
  readonly warnings: Array<string>
}

interface RunObservation {
  readonly succeeded: boolean
  readonly sandboxes: number
  readonly sandbox: FixtureFiles
  readonly onDisk: FixtureFiles
}

const SOURCE = 'export const add = (left: number, right: number): number => left + right\n'

const TEST = [
  "import { expect, test } from 'vitest'",
  "import { add } from '../src/math.ts'",
  '',
  "test('adds one and one', () => {",
  '  expect(add(1, 1)).toBe(2)',
  '})',
  '',
].join('\n')

const ROOT_TSCONFIG = [
  '// the root config',
  '{',
  '  "compilerOptions": { "strict": true },',
  '  "include": ["src/**/*.ts", "../shared/**/*.ts"],',
  '  "extends": "./tsconfig.base.json",',
  '  "references": [{ "path": "./packages/a", "prepend": false }, { "path": "../outside-lib" }],',
  '  "exclude": ["dist"],',
  '}',
  '',
].join('\n')

const BASE_TSCONFIG = '{ "files": ["../shared/types.d.ts", "src/env.d.ts"] }\n'

const PACKAGE_TSCONFIG = '{ "include": ["src", "../../../vendor/**"] }\n'

const UNPARSABLE_TSCONFIG = '{ "include": ["../shared/**"\n'

const WRITTEN_ROOT = [
  '{',
  '  "extends": "./tsconfig.base.json",',
  '  "references": [',
  '    {',
  '      "path": "./packages/a",',
  '      "prepend": false',
  '    },',
  '    {',
  '      "path": "../../../outside-lib"',
  '    }',
  '  ],',
  '  "include": [',
  '    "src/**/*.ts",',
  '    "../../../shared/**/*.ts"',
  '  ],',
  '  "exclude": [',
  '    "dist"',
  '  ],',
  '  "compilerOptions": {',
  '    "strict": true',
  '  }',
  '}',
].join('\n')

const WRITTEN_BASE = ['{', '  "files": [', '    "../../../shared/types.d.ts",', '    "src/env.d.ts"', '  ]', '}']
  .join('\n')

const WRITTEN_PACKAGE = ['{', '  "include": [', '    "src",', '    "../../../../../vendor/**"', '  ]', '}'].join('\n')

const TSCONFIG_TREE: FixtureFiles = {
  'src/math.ts': SOURCE,
  'test/math.test.mjs': TEST,
  'tsconfig.json': ROOT_TSCONFIG,
  'tsconfig.base.json': BASE_TSCONFIG,
  'packages/a/tsconfig.json': PACKAGE_TSCONFIG,
}

const UNPARSABLE_TREE: FixtureFiles = { ...TSCONFIG_TREE, 'tsconfig.json': UNPARSABLE_TSCONFIG }

const OPTIONS: Options.PartialStrykerOptions = {
  testRunner: 'vm',
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.ts'],
  reporters: [],
  checkers: [],
  tempDirName: TEMP_DIR_NAME,
  cleanTempDir: false,
  symlinkNodeModules: false,
}

const OUTSIDE: FixtureFiles = {
  'outside-lib/tsconfig.json': '{}\n',
  'shared/types.d.ts': 'export {}\n',
}

const TSCONFIGS = ['tsconfig.json', 'tsconfig.base.json', 'packages/a/tsconfig.json'] as const

const tsconfigsOf = (files: FixtureFiles): FixtureFiles =>
  Object.fromEntries(TSCONFIGS.flatMap((file) => Object.entries(files).filter(([name]) => name === file)))

const writeFiles = (directory: string, files: FixtureFiles) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* Effect.forEach(
      Object.entries(files),
      ([file, content]) =>
        fs.makeDirectory(path.dirname(path.join(directory, file)), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(path.join(directory, file), content)),
        ),
      { discard: true },
    )
  })

const writeProject = (
  files: FixtureFiles,
): Effect.Effect<ProjectFixture, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-sandbox-tsconfig-' }))
    const project = path.join(root, 'project')
    yield* writeFiles(root, OUTSIDE)
    yield* writeFiles(project, files)
    return { root, project, warnings: [] }
  })

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.remove(root, { recursive: true }))))

const warningLogger = (fixture: ProjectFixture): Layer.Layer<never> =>
  Logger.layer([
    Logger.make((entry) => {
      if (entry.logLevel === 'Warn') fixture.warnings.push([entry.message].flat().map(String).join(' '))
    }),
  ])

const runFromProject = (
  fixture: ProjectFixture,
  options: Options.PartialStrykerOptions,
): Effect.Effect<boolean, never, Engine.EnginePorts> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(fixture.project)
      return previous
    }),
    () =>
      Effect.map(Effect.result(Engine.strykerCell({ ...OPTIONS, ...options })), Result.isSuccess).pipe(
        Effect.provide(warningLogger(fixture)),
      ),
    (previous) =>
      Effect.sync(() => {
        globalThis.process.chdir(previous)
      }),
  )

const readPresent = (directory: string, files: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const present = yield* Effect.filter(files, (file) => fs.exists(path.join(directory, file)))
    const contents = yield* Effect.forEach(present, (file) =>
      Effect.map(fs.readFileString(path.join(directory, file)), (content) => [file, content] as const))
    return Object.fromEntries(contents)
  })

const sandboxOf = (project: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const tempDir = path.join(project, TEMP_DIR_NAME)
    const entries = yield* Boolean.match(yield* fs.exists(tempDir), {
      onTrue: () => fs.readDirectory(tempDir),
      onFalse: () => Effect.succeed<ReadonlyArray<string>>([]),
    })
    return entries.filter((entry) => entry.startsWith('sandbox-')).map((entry) => path.join(tempDir, entry))
  })

const observeRun = (
  fixture: ProjectFixture,
  files: FixtureFiles,
  options: Options.PartialStrykerOptions,
): Effect.Effect<RunObservation, PlatformError, Engine.EnginePorts | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const succeeded = yield* runFromProject(fixture, options)
    const sandboxes = yield* sandboxOf(fixture.project)
    const sandbox = yield* Effect.forEach(sandboxes, (directory) => readPresent(directory, TSCONFIGS))
    return {
      succeeded,
      sandboxes: sandboxes.length,
      sandbox: Object.fromEntries(sandbox.flatMap((written) => Object.entries(written))),
      onDisk: yield* readPresent(fixture.project, Object.keys(files)),
    }
  }).pipe(Effect.ensuring(removeProject(fixture.root)))

const runLayer = Layer.mergeAll(Engine.nodePlatformLayer, Stdio.layerTest({}))

Feature('Pointing the tsconfig files a mutation run copies into its sandbox back at the project')
  .withLayer(runLayer)
  .live('the scenarios run real mutation runs inside a real project directory and read the sandbox they leave behind')
  .body(({ scenario }) => {
    scenario(
      'Entries that leave the project move two levels up and every followed tsconfig is rewritten',
      Gherkin.Do.pipe(
        Given('a tsconfig that extends one file and references one package inside the project')(
          'project',
          () => writeProject(TSCONFIG_TREE),
        ),
        When('a mutation run keeps its sandbox')(
          'observation',
          (s) => observeRun(s.project, TSCONFIG_TREE, { tsconfigFile: 'tsconfig.json' }),
        ),
        Then('the sandbox holds the text the pre-refactor writer produced and the project keeps its originals')(
          (s, expect) =>
            expect({
              succeeded: s.observation.succeeded,
              sandboxes: s.observation.sandboxes,
              root: s.observation.sandbox['tsconfig.json'],
              base: s.observation.sandbox['tsconfig.base.json'],
              package: s.observation.sandbox['packages/a/tsconfig.json'],
              onDisk: s.observation.onDisk,
            }).toEqual({
              succeeded: true,
              sandboxes: 1,
              root: WRITTEN_ROOT,
              base: WRITTEN_BASE,
              package: WRITTEN_PACKAGE,
              onDisk: TSCONFIG_TREE,
            }),
        ),
      ),
    )

    scenario(
      'A tsconfig the project does not hold is skipped',
      Gherkin.Do.pipe(
        Given('a run configured with a tsconfig file that does not exist')(
          'project',
          () => writeProject(TSCONFIG_TREE),
        ),
        When('a mutation run keeps its sandbox')(
          'observation',
          (s) => observeRun(s.project, TSCONFIG_TREE, { tsconfigFile: 'tsconfig.missing.json' }),
        ),
        Then('every tsconfig is copied as it is and nothing about tsconfig warns')(
          (s, expect) =>
            expect({
              sandboxes: s.observation.sandboxes,
              sandbox: s.observation.sandbox,
              tsconfigWarnings: s.project.warnings.filter((warning) => warning.includes('tsconfig')),
            }).toEqual({ sandboxes: 1, sandbox: tsconfigsOf(TSCONFIG_TREE), tsconfigWarnings: [] }),
        ),
      ),
    )

    scenario(
      'An unparsable tsconfig is copied as it is with a warning',
      Gherkin.Do.pipe(
        Given('a project whose tsconfig is not valid JSON')('project', () => writeProject(UNPARSABLE_TREE)),
        When('a mutation run keeps its sandbox')(
          'observation',
          (s) => observeRun(s.project, UNPARSABLE_TREE, { tsconfigFile: 'tsconfig.json' }),
        ),
        Then('the sandbox copy keeps the original text and one warning names the file')(
          (s, expect) =>
            expect({
              sandboxes: s.observation.sandboxes,
              copy: s.observation.sandbox['tsconfig.json'],
              warnings: s.project.warnings.filter((warning) =>
                warning.startsWith(`Could not rewrite tsconfig file "${s.project.project}/tsconfig.json": `)
              ).length,
            }).toEqual({ sandboxes: 1, copy: UNPARSABLE_TSCONFIG, warnings: 1 }),
        ),
      ),
    )

    scenario(
      'An in-place run leaves the tsconfig unrewritten',
      Gherkin.Do.pipe(
        Given('a tsconfig whose entries would leave a sandbox')('project', () => writeProject(TSCONFIG_TREE)),
        When('the mutation run works in place')(
          'observation',
          (s) => observeRun(s.project, TSCONFIG_TREE, { tsconfigFile: 'tsconfig.json', inPlace: true }),
        ),
        Then('the run succeeds and every tsconfig on disk keeps its original text')(
          (s, expect) =>
            expect({
              succeeded: s.observation.succeeded,
              tsconfigs: tsconfigsOf(s.observation.onDisk),
            }).toEqual({ succeeded: true, tsconfigs: tsconfigsOf(TSCONFIG_TREE) }),
        ),
      ),
    )
  })
