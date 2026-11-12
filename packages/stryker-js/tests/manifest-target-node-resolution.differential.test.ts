import { NodeServices } from '@effect/platform-node'
import { Differential } from '@systemfsoftware/differential-spec'
import { Engine, ImportClosure } from '@systemfsoftware/stryker-js'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'

import {
  type NodeResolution,
  type NodeResolutions,
  probeFile,
  resolveWithNode,
} from './__fixtures__/node-resolution.fixture.js'

const TARGET_FILES: ReadonlyArray<string> = ['a.js', 'b.js', 'c.cjs']

const TARGETS: ReadonlyArray<S.Json> = TARGET_FILES.map((file) => `./${file}`)

const REJECTED_TARGETS: ReadonlyArray<S.Json> = ['/a.js', '../a.js', './x/../a.js', './node_modules/a.js']

const REJECTED_EXPORTS_TARGET: S.Json = 'a.js'

const CONDITION_KEYS: ReadonlyArray<string> = [
  'types',
  'import',
  'require',
  'node',
  'module-sync',
  'node-addons',
  'default',
  'browser',
  'module',
  '0',
  'development',
]

const entryOver = (leaves: ReadonlyArray<S.Json>): fc.Arbitrary<S.Json> =>
  fc.letrec<{ entry: S.Json }>((tie) => ({
    entry: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      fc.constantFrom<S.Json>(...leaves),
      fc.array(tie('entry'), { maxLength: 3 }),
      fc.uniqueArray(fc.tuple(fc.constantFrom(...CONDITION_KEYS), tie('entry')), {
        selector: ([key]) => key,
        minLength: 1,
        maxLength: 4,
      }).map((pairs): S.Json => Object.fromEntries(pairs)),
    ),
  })).entry

const IMPORTS_LEAVES: ReadonlyArray<S.Json> = [...TARGETS, ...REJECTED_TARGETS, null, 0, true]

interface ManifestEntries {
  readonly exportsEntry: S.Json
  readonly importsEntry: S.Json
}

const manifestEntries: fc.Arbitrary<ManifestEntries> = fc.record({
  exportsEntry: entryOver([...IMPORTS_LEAVES, REJECTED_EXPORTS_TARGET]),
  importsEntry: entryOver(IMPORTS_LEAVES),
})

const IMPORTS_TEST = 'test/imports.test.js'

const EXPORTS_TEST = 'test/exports.test.js'

const APP_DIRECTORY = ''

const LIB_DIRECTORY = 'pkgs/lib/'

const targetFilesUnder = (directory: string): ReadonlyArray<readonly [string, string]> =>
  TARGET_FILES.map((file) => [
    `${directory}${file}`,
    file.endsWith('.cjs') ? 'module.exports = { value: 1 }\n' : 'export const value = 1\n',
  ])

const projectFilesOf = (input: ManifestEntries): ReadonlyArray<readonly [string, string]> => [
  [
    `${APP_DIRECTORY}package.json`,
    JSON.stringify({ name: '@fx/app', type: 'module', imports: { '#x': input.importsEntry } }),
  ],
  [
    `${LIB_DIRECTORY}package.json`,
    JSON.stringify({ name: '@fx/lib', type: 'module', exports: { './x': input.exportsEntry } }),
  ],
  ...targetFilesUnder(APP_DIRECTORY),
  ...targetFilesUnder(LIB_DIRECTORY),
  [IMPORTS_TEST, "import '#x'\n"],
  [EXPORTS_TEST, "import '@fx/lib/x'\n"],
]

const writeProject = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory({ prefix: 'stryker-manifest-target-' })
    yield* Effect.forEach(
      files,
      ([relative, content]) =>
        fs.makeDirectory(path.dirname(path.join(root, relative)), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(path.join(root, relative), content)),
        ),
      { discard: true },
    )
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@fx'), { recursive: true })
    yield* fs.symlink(path.join(root, 'pkgs', 'lib'), path.join(root, 'node_modules', '@fx', 'lib'))
    return root
  }).pipe(Effect.orDie)

const removeProject = (root: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.ignore(FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.remove(root, { recursive: true }))))

const inProject = <A, R>(
  files: ReadonlyArray<readonly [string, string]>,
  use: (root: string) => Effect.Effect<A, never, R>,
): Effect.Effect<A, never, R | FileSystem.FileSystem | Path.Path> =>
  Effect.acquireUseRelease(writeProject(files), use, removeProject)

const nodeResolutions = (input: ManifestEntries): Effect.Effect<NodeResolutions> =>
  inProject([...projectFilesOf(input), probeFile], resolveWithNode).pipe(Effect.provide(NodeServices.layer))

const OPEN = 'open'

const CLOSED_WITHOUT_TARGET = 'closed without a target file'

interface ClosureOutcomes {
  readonly imports: string
  readonly exports: string
}

const NO_CLOSURE = 'no closure for the test file'

const outcomeOf = (analysis: ImportClosure.ImportClosureAnalysis, testFile: string, targetDirectory: string): string =>
  Option.match(Arr.findFirst(analysis.closures, (closure) => closure.testFile === testFile), {
    onNone: () => NO_CLOSURE,
    onSome: (closure) =>
      closure.open
        ? OPEN
        : Option.getOrElse(
          Arr.findFirst(TARGET_FILES, (file) => closure.files.includes(`${targetDirectory}${file}`)),
          () => CLOSED_WITHOUT_TARGET,
        ),
  })

const closureOutcomes = (input: ManifestEntries): Effect.Effect<ClosureOutcomes> => {
  const files = projectFilesOf(input)
  return inProject(files, (root) =>
    Effect.gen(function*() {
      const path = yield* Path.Path
      const analysis = yield* ImportClosure.analyzeImportClosure({
        rootDir: root,
        projectFiles: files.map(([relative]) => relative),
        testFiles: [path.join(root, IMPORTS_TEST), path.join(root, EXPORTS_TEST)],
      })
      return {
        imports: outcomeOf(analysis, IMPORTS_TEST, APP_DIRECTORY),
        exports: outcomeOf(analysis, EXPORTS_TEST, LIB_DIRECTORY),
      }
    }).pipe(Effect.orDie)).pipe(Effect.provide(Engine.nodePlatformLayer))
}

const fileEsmAndCommonJsImportersAgreeOn = ({ esm, cjs }: NodeResolution): string =>
  esm === null ? (cjs ?? OPEN) : cjs === null || cjs === esm ? esm : OPEN

const closuresFollowNode = (node: NodeResolutions, closure: ClosureOutcomes): boolean =>
  fileEsmAndCommonJsImportersAgreeOn(node.imports) === closure.imports &&
  fileEsmAndCommonJsImportersAgreeOn(node.exports) === closure.exports

Differential.compare({
  name: 'import closures contain the file Node loads for an exports or imports entry, or stay open',
  reference: nodeResolutions,
  candidate: closureOutcomes,
})
  .on(manifestEntries, {
    runBudget: 100,
    hostBound: {
      timeout: 240_000,
      reason: 'each side writes a package to a temp directory; the reference spawns node to resolve it',
    },
  })
  .assert(closuresFollowNode)
