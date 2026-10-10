import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ImportClosure } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'

const Feature = makeFeature({ it })
const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

type FixtureFiles = Readonly<Record<string, string>>

interface ClosureObservation {
  readonly files: readonly string[]
  readonly open: boolean
}

const TEST_FILE = 'test/forms.test.ts'

const VITEST_STUB: FixtureFiles = {
  'node_modules/vitest/package.json': '{"name":"vitest","main":"index.js"}',
  'node_modules/vitest/index.js':
    'export const test = () => undefined\nexport const vi = {}\nexport const vitest = {}\n',
}

const EVERY_FORM: FixtureFiles = {
  'src/all.ts': 'export const all = 1\n',
  'src/named.ts': 'export const named = 1\n',
  'src/do-mocked.ts': 'export const doMocked = 1\n',
  'src/unmocked.ts': 'export const unmocked = 1\n',
  'src/import-mocked.ts': 'export const importMocked = 1\n',
  'src/vitest-mocked.ts': 'export const vitestMocked = 1\n',
  'src/unreached.ts': 'export const unreached = 1\n',
  [TEST_FILE]: [
    "import { test, vi, vitest } from 'vitest'",
    "export * from '../src/all.js'",
    "export { named } from '../src/named.js'",
    "vi.doMock('../src/do-mocked.js')",
    "vi.unmock('../src/unmocked.js')",
    "vi.importMock('../src/import-mocked.js')",
    "vitest.mock('../src/vitest-mocked.js')",
    "vi.fn('../src/unreached.js')",
    'const pattern = /forms?/giu',
    'const big = 9007199254740993n',
    "test('forms', () => { pattern; big })",
    '',
  ].join('\n'),
}

const TEMPLATE_SPECIFIER: FixtureFiles = {
  'src/lazy.ts': 'export const lazy = 1\n',
  [TEST_FILE]:
    "import { test } from 'vitest'\nconst lazy = import(`../src/lazy.js`)\ntest('template', () => { lazy })\n",
}

const UNPARSABLE: FixtureFiles = {
  'src/static.ts': 'export const stat = 1\n',
  [TEST_FILE]: "import { test } from 'vitest'\nimport { stat } from '../src/static.js'\ntest('broken', () => { stat\n",
}

const ESCAPED_SPECIFIER: FixtureFiles = {
  'src/a.ts': 'export const a = 1\n',
  [TEST_FILE]: "import { test } from 'vitest'\nimport { a } from '../src/\\x61.js'\ntest('escaped', () => { a })\n",
}

const BIGINT_MOCK: FixtureFiles = {
  'src/kept.ts': 'export const kept = 1\n',
  [TEST_FILE]:
    "import { test, vi } from 'vitest'\nimport { kept } from '../src/kept.js'\nvi.mock(1n)\ntest('bigint mock', () => { kept })\n",
}

const writeFixture = (files: FixtureFiles): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory({ prefix: 'stryker-import-closure-parsing-' })
    yield* Effect.forEach(
      Object.entries({ ...VITEST_STUB, ...files }),
      ([file, content]) =>
        fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(path.join(root, file), content)),
        ),
      { discard: true },
    )
    return root
  })

const removeDirectory = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.remove(root, { recursive: true }))))

const observe = (
  root: string,
  files: FixtureFiles,
): Effect.Effect<ClosureObservation, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const analysis = yield* ImportClosure.analyzeImportClosure({
      rootDir: root,
      projectFiles: Object.keys(files),
      testFiles: [path.join(root, TEST_FILE)],
      globalInputs: [],
    })
    return Option.getOrElse(
      Option.map(
        Option.fromUndefinedOr(analysis.closures.find((closure) => closure.testFile === TEST_FILE)),
        (closure) => ({ files: [...closure.files].sort(), open: closure.open }),
      ),
      () => ({ files: [], open: false }),
    )
  }).pipe(Effect.ensuring(removeDirectory(root)))

Feature('Reading the import forms of a module from its parsed source')
  .withLayer(filePorts)
  .live('the scenarios parse real files on disk with the closure analysis')
  .body(({ scenario }) => {
    scenario(
      'Re-exports and every vitest mock form are followed while regex and bigint literals parse cleanly',
      Gherkin.Do.pipe(
        Given('a test file using every import form beside a regex and a bigint literal')(
          'root',
          () => writeFixture(EVERY_FORM),
        ),
        When('the closure of that test file is analyzed')('observation', (s) => observe(s.root, EVERY_FORM)),
        Then('every form names a closure member and the closure stays closed')((s, expect) =>
          expect(s.observation).toEqual({
            files: [
              'src/all.ts',
              'src/do-mocked.ts',
              'src/import-mocked.ts',
              'src/named.ts',
              'src/unmocked.ts',
              'src/vitest-mocked.ts',
              TEST_FILE,
            ],
            open: false,
          })
        ),
      ),
    )

    scenario(
      'A dynamic import written as a template literal opens the closure',
      Gherkin.Do.pipe(
        Given('a test file importing a module through a template literal without expressions')(
          'root',
          () => writeFixture(TEMPLATE_SPECIFIER),
        ),
        When('the closure of that test file is analyzed')('observation', (s) => observe(s.root, TEMPLATE_SPECIFIER)),
        Then('the closure is open and lists only the test file')((s, expect) =>
          expect(s.observation).toEqual({ files: [TEST_FILE], open: true })
        ),
      ),
    )

    scenario(
      'A test file the parser rejects opens its closure and follows none of its imports',
      Gherkin.Do.pipe(
        Given('a test file with a syntax error after a static import')('root', () => writeFixture(UNPARSABLE)),
        When('the closure of that test file is analyzed')('observation', (s) => observe(s.root, UNPARSABLE)),
        Then('the closure is open and lists only the test file, not the module imported above the error')((
          s,
          expect,
        ) => expect(s.observation).toEqual({ files: [TEST_FILE], open: true })),
      ),
    )

    scenario(
      'An import specifier written with an escape names the module its cooked text spells',
      Gherkin.Do.pipe(
        Given('a test file importing ../src/a.js with the a written as \\x61')(
          'root',
          () => writeFixture(ESCAPED_SPECIFIER),
        ),
        When('the closure of that test file is analyzed')('observation', (s) => observe(s.root, ESCAPED_SPECIFIER)),
        Then('the closure lists src/a.ts and stays closed')((s, expect) =>
          expect(s.observation).toEqual({ files: ['src/a.ts', TEST_FILE], open: false })
        ),
      ),
    )

    scenario(
      'A vitest mock of a bigint literal neither names a module nor opens the closure',
      Gherkin.Do.pipe(
        Given('a test file calling vi.mock(1n) beside a static import')('root', () => writeFixture(BIGINT_MOCK)),
        When('the closure of that test file is analyzed')('observation', (s) => observe(s.root, BIGINT_MOCK)),
        Then('the closure keeps the static import and stays closed')((s, expect) =>
          expect(s.observation).toEqual({ files: ['src/kept.ts', TEST_FILE], open: false })
        ),
      ),
    )
  })
