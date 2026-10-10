import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Cli, Engine } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as Stdio from 'effect/Stdio'

const Feature = makeFeature({ it })

const TEMP_DIR_NAME = '.stryker-tmp'

const testFileOf = (expected: number): string =>
  [
    "import { expect, test } from 'vitest'",
    "import { add } from '../src/math.ts'",
    '',
    "test('adds one and one', () => {",
    `  expect(add(1, 1)).toBe(${expected})`,
    '})',
  ].join('\n')

const TEST_FILES = { passes: testFileOf(2), fails: testFileOf(3) } as const

const writeProject = (
  tests: keyof typeof TEST_FILES,
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
    yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
    yield* fs.makeDirectory(path.join(root, 'test'), { recursive: true })
    yield* fs.writeFileString(
      path.join(root, 'src/math.ts'),
      'export const add = (left: number, right: number): number => left + right\n',
    )
    yield* fs.writeFileString(path.join(root, 'test/math.test.mjs'), TEST_FILES[tests])
    return root
  })

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.remove(root, { recursive: true }))))

const runFromProject = (
  root: string,
  options: Options.PartialStrykerOptions,
): Effect.Effect<boolean, never, Engine.EnginePorts> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(root)
      return previous
    }),
    () => Effect.map(Effect.result(Cli.strykerCell(options)), Result.isSuccess),
    (previous) =>
      Effect.sync(() => {
        globalThis.process.chdir(previous)
      }),
  )

const sandboxesLeftIn = (root: string): Effect.Effect<number, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const tempDir = path.join(root, TEMP_DIR_NAME)
    const entries = yield* Boolean.match(yield* fs.exists(tempDir), {
      onTrue: () => fs.readDirectory(tempDir),
      onFalse: () => Effect.succeed<ReadonlyArray<string>>([]),
    })
    return entries.filter((entry) => entry.startsWith('sandbox-')).length
  })

const SANDBOXES_LEFT = { 'its sandbox': 1, 'no sandbox': 0 } as const

const runLayer = Layer.mergeAll(Cli.platformLayer, Stdio.layerTest({}))

Feature('Keeping or removing the sandbox a mutation run leaves behind')
  .withLayer(runLayer)
  .live('the scenario runs real test runs inside a real project directory')
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'A run that <ends> with sandbox cleaning set to <setting> leaves <left> behind',
      [
        { ends: 'succeeds', setting: 'never', cleanTempDir: false, tests: 'passes', left: 'its sandbox' },
        { ends: 'fails', setting: 'never', cleanTempDir: false, tests: 'fails', left: 'its sandbox' },
        { ends: 'succeeds', setting: 'after success', cleanTempDir: true, tests: 'passes', left: 'no sandbox' },
        { ends: 'fails', setting: 'after success', cleanTempDir: true, tests: 'fails', left: 'its sandbox' },
        { ends: 'succeeds', setting: 'always', cleanTempDir: 'always', tests: 'passes', left: 'no sandbox' },
        { ends: 'fails', setting: 'always', cleanTempDir: 'always', tests: 'fails', left: 'no sandbox' },
      ] as const,
      (row) =>
        Gherkin.Do.pipe(
          Given(`a project whose test suite ${row.tests}`)('root', () => writeProject(row.tests)),
          When('the mutation run finishes')('succeeded', (s) =>
            runFromProject(s.root, {
              testRunner: 'vm',
              testFiles: ['test/**/*.mjs'],
              mutate: ['src/**/*.ts'],
              reporters: [],
              checkers: [],
              tempDirName: TEMP_DIR_NAME,
              cleanTempDir: row.cleanTempDir,
            })),
          Then(`the run ${row.ends} and the project holds ${row.left}`)((s, expect) =>
            sandboxesLeftIn(s.root).pipe(
              Effect.map((sandboxes) =>
                expect({ succeeded: s.succeeded, sandboxes }).toEqual({
                  succeeded: row.tests === 'passes',
                  sandboxes: SANDBOXES_LEFT[row.left],
                })
              ),
              Effect.ensuring(removeProject(s.root)),
            )
          ),
        ),
    )
  })
