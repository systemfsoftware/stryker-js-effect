import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { ImportClosure } from '@systemfsoftware/stryker-js'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'

type ImportClosureAnalysis = ImportClosure.ImportClosureAnalysis

const analyzeImportClosure = ImportClosure.analyzeImportClosure

const Feature = makeFeature({ it })
const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

type FixtureFiles = Readonly<Record<string, string>>

interface FixtureSpec {
  readonly files: FixtureFiles
  readonly links?: FixtureFiles
  readonly testFiles: readonly string[]
  readonly globalInputs?: readonly string[]
  readonly changed?: FixtureFiles
}

interface Observation {
  readonly before: ImportClosureAnalysis
  readonly after: ImportClosureAnalysis
  readonly projectFiles: readonly string[]
}

const VITEST_STUB: FixtureFiles = {
  'node_modules/vitest/package.json': '{"name":"vitest","main":"index.js"}',
  'node_modules/vitest/index.js':
    'export const test = () => undefined\nexport const expect = () => undefined\nexport const beforeAll = () => undefined\nexport const vi = { mock: () => undefined, importActual: () => undefined }\n',
}

const writeFileAt = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  file: string,
  content: string,
): Effect.Effect<void, PlatformError> => {
  const target = path.join(root, file)
  return fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(
    Effect.andThen(fs.writeFileString(target, content)),
  )
}

const writeFixture = (spec: FixtureSpec): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory({ prefix: 'stryker-import-closure-' })
    yield* Effect.forEach(
      Object.entries({ ...VITEST_STUB, ...spec.files }),
      ([file, content]) => writeFileAt(fs, path, root, file, content),
      { discard: true },
    )
    yield* Effect.forEach(
      Object.entries(spec.links ?? {}),
      ([link, target]) => {
        const linkPath = path.join(root, link)
        return fs.makeDirectory(path.dirname(linkPath), { recursive: true }).pipe(
          Effect.andThen(fs.symlink(path.join(root, target), linkPath)),
        )
      },
      { discard: true },
    )
    return root
  })

const removeDirectory = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.remove(root, { recursive: true }))))

const observe = (
  root: string,
  spec: FixtureSpec,
): Effect.Effect<Observation, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const projectFiles = Object.keys({ ...VITEST_STUB, ...spec.files }).filter(
      (file) => !file.startsWith('node_modules/'),
    )
    const input = {
      rootDir: root,
      projectFiles,
      testFiles: spec.testFiles.map((file) => path.join(root, file)),
      globalInputs: (spec.globalInputs ?? []).map((file) => path.join(root, file)),
    }
    const before = yield* analyzeImportClosure(input)
    yield* Effect.forEach(
      Object.entries(spec.changed ?? {}),
      ([file, content]) => fs.writeFileString(path.join(root, file), content),
      { discard: true },
    )
    const after = yield* analyzeImportClosure(input)
    return { before, after, projectFiles }
  })

const closureOf = (analysis: ImportClosureAnalysis, testFile: string) =>
  Option.fromUndefinedOr(analysis.closures.find((closure) => closure.testFile === testFile))

const filesOf = (analysis: ImportClosureAnalysis, testFile: string): readonly string[] =>
  Option.getOrElse(Option.map(closureOf(analysis, testFile), (closure) => [...closure.files].sort()), () => [])

const openOf = (analysis: ImportClosureAnalysis, testFile: string): boolean =>
  Option.getOrElse(Option.map(closureOf(analysis, testFile), (closure) => closure.open), () => true)

const digestOf = (analysis: ImportClosureAnalysis, testFile: string): string =>
  Option.getOrElse(Option.map(closureOf(analysis, testFile), (closure) => closure.digest), () => '')

const digestMoved = (observation: Observation, testFile: string): boolean =>
  digestOf(observation.before, testFile) !== digestOf(observation.after, testFile)

const DEEP_CHAIN: FixtureSpec = {
  files: {
    'src/deep.ts': 'export const deep = 1\n',
    'src/helper.ts': "import { deep } from './deep.js'\nexport const helper = deep + 1\n",
    'src/unused.ts': 'export const unused = 0\n',
    'test/answer.test.ts':
      "import { expect, test } from 'vitest'\nimport { helper } from '../src/helper.js'\ntest('adds one', () => expect(helper).toBe(2))\n",
  },
  testFiles: ['test/answer.test.ts'],
  changed: { 'src/deep.ts': 'export const deep = 2\n' },
}

const UNREACHED: FixtureSpec = {
  files: {
    'src/used.ts': 'export const used = 1\n',
    'src/unused.ts': 'export const unused = 0\n',
    'test/answer.test.ts':
      "import { test } from 'vitest'\nimport { used } from '../src/used.js'\ntest('used', () => { used })\n",
  },
  testFiles: ['test/answer.test.ts'],
  changed: { 'src/unused.ts': 'export const unused = 1\n' },
}

const CYCLE: FixtureSpec = {
  files: {
    'src/a.ts': "import { b } from './b.js'\nexport const a = (): number => (b() > 0 ? 1 : 0)\n",
    'src/b.ts': "import { a } from './a.js'\nexport const b = (): number => a()\n",
    'test/cycle.test.ts':
      "import { test } from 'vitest'\nimport { a } from '../src/a.js'\ntest('cycle', () => { a })\n",
  },
  testFiles: ['test/cycle.test.ts'],
}

const NON_LITERAL: FixtureSpec = {
  files: {
    'src/static.ts': 'export const stat = 1\n',
    'src/lazy.ts': 'export const lazy = 1\n',
    'src/unused.ts': 'export const unused = 0\n',
    'test/dynamic.test.ts':
      "import { test } from 'vitest'\nimport { stat } from '../src/static.js'\nconst name = '../src/lazy.js'\nexport const load = () => import(name)\ntest('stat', () => { stat })\n",
  },
  testFiles: ['test/dynamic.test.ts'],
  changed: { 'src/unused.ts': 'export const unused = 1\n' },
}

const LITERALS: FixtureSpec = {
  files: {
    'src/lazy.ts': 'export const lazy = 1\n',
    'src/legacy.cjs': 'module.exports = { legacy: 1 }\n',
    'src/folder/index.ts': 'export const folder = 1\n',
    'test/literal.test.ts':
      "import { test } from 'vitest'\nimport { folder } from '../src/folder'\nconst lazy = import('../src/lazy.js')\nconst legacy = require('../src/legacy.cjs')\ntest('literal', () => { folder; lazy; legacy })\n",
  },
  testFiles: ['test/literal.test.ts'],
}

const MOCKED: FixtureSpec = {
  files: {
    'src/clock.ts': 'export const now = (): number => 0\n',
    'test/mock.test.ts':
      "import { vi } from 'vitest'\nvi.mock('../src/clock.js')\nvi.importActual('../src/clock.js')\n",
  },
  testFiles: ['test/mock.test.ts'],
}

const GLOBAL_INPUT: FixtureSpec = {
  files: {
    'vitest.setup.ts': "import { beforeAll } from 'vitest'\nbeforeAll(() => 0)\n",
    'src/shared.ts': 'export const shared = 1\n',
    'test/one.test.ts':
      "import { test } from 'vitest'\nimport { shared } from '../src/shared.js'\ntest('one', () => { shared })\n",
    'test/two.test.ts':
      "import { test } from 'vitest'\nimport { shared } from '../src/shared.js'\ntest('two', () => { shared })\n",
  },
  testFiles: ['test/one.test.ts', 'test/two.test.ts'],
  globalInputs: ['vitest.setup.ts'],
  changed: { 'vitest.setup.ts': "import { beforeAll } from 'vitest'\nbeforeAll(() => 1)\n" },
}

const WORKSPACE_LINK: FixtureSpec = {
  files: {
    'node_modules/dep/package.json': '{"name":"dep","main":"index.js"}',
    'node_modules/dep/index.js': 'export const dep = 1\n',
    'pkgs/lib/package.json':
      '{"name":"@fixture/lib","exports":{".":{"@systemfsoftware/source":"./src/index.ts","default":"./dist/index.js"}}}',
    'pkgs/lib/src/index.ts': 'export const lib = 1\n',
    'pkgs/legacy/package.json': '{"name":"@fixture/legacy","main":"./src/index.ts"}',
    'pkgs/legacy/src/index.ts': 'export const legacy = 1\n',
    'src/app.ts':
      "import { dep } from 'dep'\nimport { lib } from '@fixture/lib'\nimport { legacy } from '@fixture/legacy'\nexport const app = dep + lib + legacy\n",
    'test/link.test.ts':
      "import { test } from 'vitest'\nimport { app } from '../src/app.js'\ntest('app', () => { app })\n",
  },
  links: { 'node_modules/@fixture/lib': 'pkgs/lib', 'node_modules/@fixture/legacy': 'pkgs/legacy' },
  testFiles: ['test/link.test.ts'],
}

const vitestStubAt = (prefix: string): FixtureFiles =>
  Object.fromEntries(Object.entries(VITEST_STUB).map(([file, content]) => [`${prefix}/${file}`, content]))

const EXTERNAL_GLOBAL_INPUT: FixtureSpec = {
  files: {
    'node_modules/@fixture/guard/package.json': '{"name":"@fixture/guard","type":"module"}',
    'node_modules/@fixture/guard/guard.mjs': 'export const guard = 1\n',
    'src/shared.ts': 'export const shared = 1\n',
    'src/unreached.ts': 'export const unreached = 0\n',
    'test/one.test.ts':
      "import { test } from 'vitest'\nimport { shared } from '../src/shared.js'\ntest('one', () => { shared })\n",
  },
  testFiles: ['test/one.test.ts'],
  globalInputs: ['node_modules/@fixture/guard/guard.mjs'],
  changed: { 'src/unreached.ts': 'export const unreached = 1\n' },
}

const REACHED_CHANGE_UNDER_EXTERNAL_GLOBAL_INPUT: FixtureSpec = {
  ...EXTERNAL_GLOBAL_INPUT,
  changed: { 'src/shared.ts': 'export const shared = 2\n' },
}

const LINKED_ACROSS_ROOTS: FixtureSpec = {
  files: {
    ...vitestStubAt('app'),
    'app/src/app.ts': "import { lib } from '@fixture/lib'\nexport const app = lib + 1\n",
    'app/src/unreached.ts': 'export const unreached = 0\n',
    'app/test/one.test.ts':
      "import { test } from 'vitest'\nimport { app } from '../src/app.js'\ntest('app', () => { app })\n",
    'app-lib/package.json':
      '{"name":"@fixture/lib","exports":{".":{"@systemfsoftware/source":"./src/index.ts","default":"./index.mjs"}}}',
    'app-lib/src/index.ts': 'export const lib = 1\n',
  },
  links: { 'app/node_modules/@fixture/lib': 'app-lib' },
  testFiles: ['app/test/one.test.ts'],
}

interface LinkedObservation {
  readonly before: ImportClosureAnalysis
  readonly afterLinked: ImportClosureAnalysis
  readonly afterUnreached: ImportClosureAnalysis
  readonly linkedIndex: string
}

const observeLinked = (
  root: string,
  spec: FixtureSpec,
): Effect.Effect<LinkedObservation, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const projectRoot = path.join(root, 'app')
    const projectFiles = Object.keys({ ...vitestStubAt('app'), ...spec.files })
      .filter((file) => file.startsWith('app/') && !file.startsWith('app/node_modules/'))
      .map((file) => path.join(root, file))
    const input = {
      rootDir: projectRoot,
      projectFiles,
      testFiles: spec.testFiles.map((file) => path.join(root, file)),
    }
    const before = yield* analyzeImportClosure(input)
    yield* fs.writeFileString(path.join(root, 'app-lib', 'src', 'index.ts'), 'export const lib = 2\n')
    const afterLinked = yield* analyzeImportClosure(input)
    yield* fs.writeFileString(path.join(root, 'app', 'src', 'unreached.ts'), 'export const unreached = 1\n')
    const afterUnreached = yield* analyzeImportClosure(input)
    return { before, afterLinked, afterUnreached, linkedIndex: path.join(root, 'app-lib', 'src', 'index.ts') }
  })

const MANIFEST = '{"name":"@fixture/app","version":"1.0.0","type":"module"}'

const manifestReadingSpecWith = (changedManifest: string): FixtureSpec => ({
  files: {
    'package.json': MANIFEST,
    'src/version.ts':
      "import manifest from '../package.json' with { type: 'json' }\nexport const version = manifest.version\n",
    'test/version.test.ts':
      "import { test } from 'vitest'\nimport { version } from '../src/version.js'\ntest('version', () => { version })\n",
  },
  testFiles: ['test/version.test.ts'],
  changed: { 'package.json': changedManifest },
})

const VERSION_BUMP = manifestReadingSpecWith('{"name":"@fixture/app","version":"1.0.1","type":"module"}')

const MANIFEST_FIELD_CHANGE = manifestReadingSpecWith('{"name":"@fixture/app","version":"1.0.0","type":"commonjs"}')

Feature('Mapping a test file to the import closure it can reach')
  .withLayer(filePorts)
  .live('the scenarios read, parse and hash real project files off the filesystem, which the kernel cannot settle')
  .body(({ scenario }) => {
    scenario(
      'A change two imports deep moves the digest of the test file that reaches it',
      Gherkin.Do.pipe(
        Given('a project whose test file imports a helper that imports a deep module')(
          'root',
          () => writeFixture(DEEP_CHAIN),
        ),
        When('the closure is analyzed before and after the deep module changes')(
          'observation',
          (s) => observe(s.root, DEEP_CHAIN).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the closure holds every module on the way and its digest moves')(
          (s, expect) =>
            expect({
              files: filesOf(s.observation.before, 'test/answer.test.ts'),
              open: openOf(s.observation.before, 'test/answer.test.ts'),
              digestMoved: digestMoved(s.observation, 'test/answer.test.ts'),
            }).toEqual({
              files: ['src/deep.ts', 'src/helper.ts', 'test/answer.test.ts'],
              open: false,
              digestMoved: true,
            }),
        ),
      ),
    )

    scenario(
      'A change to a file no closure reaches leaves the digest of a closed closure still',
      Gherkin.Do.pipe(
        Given('a project with a module nothing imports')('root', () => writeFixture(UNREACHED)),
        When('the closure is analyzed before and after that unreached module changes')(
          'observation',
          (s) => observe(s.root, UNREACHED).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the closure omits the unreached module and its digest stands still')(
          (s, expect) =>
            expect({
              files: filesOf(s.observation.before, 'test/answer.test.ts'),
              open: openOf(s.observation.before, 'test/answer.test.ts'),
              digestMoved: digestMoved(s.observation, 'test/answer.test.ts'),
            }).toEqual({
              files: ['src/used.ts', 'test/answer.test.ts'],
              open: false,
              digestMoved: false,
            }),
        ),
      ),
    )

    scenario(
      'A cycle between two modules terminates with each member listed once',
      Gherkin.Do.pipe(
        Given('a project whose two modules import each other')('root', () => writeFixture(CYCLE)),
        When('the closure of the test file that reaches them is analyzed')(
          'observation',
          (s) => observe(s.root, CYCLE).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the closure lists both modules once and stays closed')(
          (s, expect) =>
            expect({
              files: filesOf(s.observation.before, 'test/cycle.test.ts'),
              open: openOf(s.observation.before, 'test/cycle.test.ts'),
            }).toEqual({ files: ['src/a.ts', 'src/b.ts', 'test/cycle.test.ts'], open: false }),
        ),
      ),
    )

    scenario(
      'A dynamic import of a computed specifier opens the closure',
      Gherkin.Do.pipe(
        Given('a project whose test file imports a module by a computed name')('root', () => writeFixture(NON_LITERAL)),
        When('the closure is analyzed before and after a file it never reaches changes')(
          'observation',
          (s) => observe(s.root, NON_LITERAL).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the closure is open and its digest moves with any project file')(
          (s, expect) =>
            expect({
              open: openOf(s.observation.before, 'test/dynamic.test.ts'),
              digestMoved: digestMoved(s.observation, 'test/dynamic.test.ts'),
            }).toEqual({ open: true, digestMoved: true }),
        ),
      ),
    )

    scenario(
      'A literal dynamic import, a require and a directory index are all followed',
      Gherkin.Do.pipe(
        Given('a project whose test file reaches modules three ways')('root', () => writeFixture(LITERALS)),
        When('the closure of that test file is analyzed')(
          'observation',
          (s) => observe(s.root, LITERALS).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('every reached module is listed and the closure stays closed')(
          (s, expect) =>
            expect({
              files: filesOf(s.observation.before, 'test/literal.test.ts'),
              open: openOf(s.observation.before, 'test/literal.test.ts'),
            }).toEqual({
              files: ['src/folder/index.ts', 'src/lazy.ts', 'src/legacy.cjs', 'test/literal.test.ts'],
              open: false,
            }),
        ),
      ),
    )

    scenario(
      'A vitest mock specifier reaches the mocked module',
      Gherkin.Do.pipe(
        Given('a project whose test file mocks and imports for real the same module')(
          'root',
          () => writeFixture(MOCKED),
        ),
        When('the closure of that test file is analyzed')(
          'observation',
          (s) => observe(s.root, MOCKED).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the mocked module is listed and the closure stays closed')(
          (s, expect) =>
            expect({
              files: filesOf(s.observation.before, 'test/mock.test.ts'),
              open: openOf(s.observation.before, 'test/mock.test.ts'),
            }).toEqual({ files: ['src/clock.ts', 'test/mock.test.ts'], open: false }),
        ),
      ),
    )

    scenario(
      'A runner-reported global input joins every closure and moves every digest',
      Gherkin.Do.pipe(
        Given('a project with two test files and a setup file the runner reports')(
          'root',
          () => writeFixture(GLOBAL_INPUT),
        ),
        When('both closures are analyzed before and after the setup file changes')(
          'observation',
          (s) => observe(s.root, GLOBAL_INPUT).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the setup file is in both closures and both digests move')(
          (s, expect) =>
            expect(
              ['test/one.test.ts', 'test/two.test.ts'].map((testFile) => ({
                testFile,
                inClosure: filesOf(s.observation.before, testFile).includes('vitest.setup.ts'),
                open: openOf(s.observation.before, testFile),
                digestMoved: digestMoved(s.observation, testFile),
              })),
            ).toEqual([
              { testFile: 'test/one.test.ts', inClosure: true, open: false, digestMoved: true },
              { testFile: 'test/two.test.ts', inClosure: true, open: false, digestMoved: true },
            ]),
        ),
      ),
    )

    scenario(
      'A dependency inside node_modules is external while a workspace link is followed',
      Gherkin.Do.pipe(
        Given('a project depending on an installed package and on a linked workspace package')(
          'root',
          () => writeFixture(WORKSPACE_LINK),
        ),
        When('the closure of that test file is analyzed')(
          'observation',
          (s) => observe(s.root, WORKSPACE_LINK).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the linked package sources are listed, nothing under node_modules is, and the closure stays closed')(
          (s, expect) => {
            const files = filesOf(s.observation.before, 'test/link.test.ts')
            return expect({
              sourceConditionLink: files.includes('pkgs/lib/src/index.ts'),
              mainFieldLink: files.includes('pkgs/legacy/src/index.ts'),
              outsideNodeModules: files.every((file) => !file.startsWith('node_modules/')),
              open: openOf(s.observation.before, 'test/link.test.ts'),
            }).toEqual({ sourceConditionLink: true, mainFieldLink: true, outsideNodeModules: true, open: false })
          },
        ),
      ),
    )

    scenario(
      'A release that only bumps the package version leaves the digest of a closure reading the manifest still',
      Gherkin.Do.pipe(
        Given('a project whose source imports its own package.json')('root', () => writeFixture(VERSION_BUMP)),
        When('the closure is analyzed before and after the version field alone changes')(
          'observation',
          (s) => observe(s.root, VERSION_BUMP).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the manifest is in the closure and the digest stands still')(
          (s, expect) =>
            expect({
              manifestInClosure: filesOf(s.observation.before, 'test/version.test.ts').includes('package.json'),
              digestMoved: digestMoved(s.observation, 'test/version.test.ts'),
            }).toEqual({ manifestInClosure: true, digestMoved: false }),
        ),
      ),
    )

    scenario(
      'Any other manifest change still moves the digest of a closure reading the manifest',
      Gherkin.Do.pipe(
        Given('a project whose source imports its own package.json')('root', () => writeFixture(MANIFEST_FIELD_CHANGE)),
        When('the closure is analyzed before and after a field other than the version changes')(
          'observation',
          (s) => observe(s.root, MANIFEST_FIELD_CHANGE).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the manifest is in the closure and the digest moves')(
          (s, expect) =>
            expect({
              manifestInClosure: filesOf(s.observation.before, 'test/version.test.ts').includes('package.json'),
              digestMoved: digestMoved(s.observation, 'test/version.test.ts'),
            }).toEqual({ manifestInClosure: true, digestMoved: true }),
        ),
      ),
    )

    scenario(
      'A runner-reported global input installed in node_modules leaves the closures closed',
      Gherkin.Do.pipe(
        Given('a project whose test runner reports a setup file from an installed package')(
          'root',
          () => writeFixture(EXTERNAL_GLOBAL_INPUT),
        ),
        When('the closure is analyzed before and after a project file it never reaches changes')(
          'observation',
          (s) => observe(s.root, EXTERNAL_GLOBAL_INPUT).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the setup file joins no closure, the closure stays closed, and the digest stands still')(
          (s, expect) =>
            expect({
              files: filesOf(s.observation.before, 'test/one.test.ts'),
              open: openOf(s.observation.before, 'test/one.test.ts'),
              digestMoved: digestMoved(s.observation, 'test/one.test.ts'),
            }).toEqual({
              files: ['src/shared.ts', 'test/one.test.ts'],
              open: false,
              digestMoved: false,
            }),
        ),
      ),
    )

    scenario(
      'A change to a file the closure reaches still moves its digest under an installed setup file',
      Gherkin.Do.pipe(
        Given('a project whose test runner reports a setup file from an installed package')(
          'root',
          () => writeFixture(REACHED_CHANGE_UNDER_EXTERNAL_GLOBAL_INPUT),
        ),
        When('the closure is analyzed before and after the file its test imports changes')(
          'observation',
          (s) =>
            observe(s.root, REACHED_CHANGE_UNDER_EXTERNAL_GLOBAL_INPUT).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the closure stays closed and the digest moves')(
          (s, expect) =>
            expect({
              open: openOf(s.observation.before, 'test/one.test.ts'),
              digestMoved: digestMoved(s.observation, 'test/one.test.ts'),
            }).toEqual({ open: false, digestMoved: true }),
        ),
      ),
    )

    scenario(
      'A workspace package linked outside the project root is followed through its real sources',
      Gherkin.Do.pipe(
        Given('a project whose workspace link points at a sibling directory named after the project root')(
          'root',
          () => writeFixture(LINKED_ACROSS_ROOTS),
        ),
        When('the closure is analyzed, then the linked source changes, then an unreached project file changes')(
          'observation',
          (s) => observeLinked(s.root, LINKED_ACROSS_ROOTS).pipe(Effect.ensuring(removeDirectory(s.root))),
        ),
        Then('the linked source joins a closed closure and only its change moves the digest')(
          (s, expect) => {
            const before = filesOf(s.observation.before, 'test/one.test.ts')
            const digestOfBefore = digestOf(s.observation.before, 'test/one.test.ts')
            return expect({
              projectFileInClosure: before.includes('src/app.ts'),
              linkedInClosure: before.includes(s.observation.linkedIndex),
              unreachedInClosure: before.includes('src/unreached.ts'),
              open: openOf(s.observation.before, 'test/one.test.ts'),
              linkedChangeMoved: digestOfBefore !== digestOf(s.observation.afterLinked, 'test/one.test.ts'),
              unreachedChangeMoved: digestOf(s.observation.afterLinked, 'test/one.test.ts') !==
                digestOf(s.observation.afterUnreached, 'test/one.test.ts'),
            }).toEqual({
              projectFileInClosure: true,
              linkedInClosure: true,
              unreachedInClosure: false,
              open: false,
              linkedChangeMoved: true,
              unreachedChangeMoved: false,
            })
          },
        ),
      ),
    )
  })
