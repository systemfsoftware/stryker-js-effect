import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerRuntime } from '@systemfsoftware/stryker-js-typescript-checker/runtime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const FILE_PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
)

const TSCONFIG_FILE = 'tsconfig.json'
const MAIN_FILE = 'src/main.ts'
const CHAIN_FILE = 'src/chain.ts'
const DECLARATION_FILE = 'src/deep/types.d.ts'
const OUTSIDE_FILE = 'outside/notes.ts'

const TSCONFIG_SOURCE = JSON.stringify(
  {
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true },
    include: ['src'],
  },
  null,
  2,
) + '\n'

const STRICT_TSCONFIG_SOURCE = JSON.stringify(
  {
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: false },
    include: ['src'],
  },
  null,
  2,
) + '\n'

const BASE_TSCONFIG_FILE = 'tsconfig.base.json'
const BASE_TSCONFIG_SOURCE = JSON.stringify(
  { compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true } },
  null,
  2,
) + '\n'
const CHANGED_BASE_TSCONFIG_SOURCE = JSON.stringify(
  { compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: false } },
  null,
  2,
) + '\n'
const EXTENDS_TSCONFIG_SOURCE = JSON.stringify({ extends: `./${BASE_TSCONFIG_FILE}`, include: ['src'] }, null, 2) +
  '\n'
const PACKAGE_BASE_TSCONFIG_FILE = 'node_modules/@probe/tsconfig-base/tsconfig.json'
const PACKAGE_EXTENDS_TSCONFIG_SOURCE = JSON.stringify(
  { extends: '@probe/tsconfig-base/tsconfig.json', include: ['src'] },
  null,
  2,
) + '\n'

const MAIN_SOURCE = [
  "import { shifted } from './chain.js'",
  '',
  'export const doubled = (value: number): number => value * 2',
  'export const combined = (value: number): number => doubled(value) + shifted()',
  '',
].join('\n')

const CHAIN_SOURCE = [
  "import type { Offset } from './deep/types.js'",
  '',
  'export const shifted = (): number => (1 as Offset) + 1',
  '',
].join('\n')

const DECLARATION_SOURCE = 'export type Offset = number\n'

const OUTSIDE_SOURCE = 'export const notes: number = 1\n'

interface Workspace {
  readonly directory: string
}

const DEFAULT_FILES: Readonly<Record<string, string>> = {
  [TSCONFIG_FILE]: TSCONFIG_SOURCE,
  [MAIN_FILE]: MAIN_SOURCE,
  [CHAIN_FILE]: CHAIN_SOURCE,
  [DECLARATION_FILE]: DECLARATION_SOURCE,
  [OUTSIDE_FILE]: OUTSIDE_SOURCE,
}

const writeWorkspace = (
  files: Readonly<Record<string, string>> = DEFAULT_FILES,
): Effect.Effect<Workspace, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    yield* Effect.forEach(
      Object.entries(files),
      ([name, content]) =>
        Effect.gen(function*() {
          const target = path.join(directory, name)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    return { directory }
  }).pipe(Effect.orDie)

const removeWorkspace = (directory: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.orDie(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })),
  )

const rewriteFile = (directory: string, file: string, content: string): Effect.Effect<void, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* fs.writeFileString(`${directory}/${file}`, content)
  }).pipe(Effect.orDie, Effect.provide(FILE_AND_PATH))

const appendComment = (directory: string, file: string): Effect.Effect<void, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(`${directory}/${file}`)
    yield* fs.writeFileString(`${directory}/${file}`, `${text}// edited between runs\n`)
  }).pipe(Effect.orDie, Effect.provide(FILE_AND_PATH))

const digestOf = (
  directory: string,
  checkerOptions?: Readonly<Record<string, S.Json | object>>,
): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const pathService = yield* Path.Path
    const options = yield* S.decodeEffect(Options.StrykerOptionsSchema)({
      tsconfigFile: pathService.join(directory, TSCONFIG_FILE),
      ...(checkerOptions === undefined ? {} : { typescriptChecker: checkerOptions }),
    })
    return yield* Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const checker = yield* Effect.orDie(runtime.checker)
      return String(yield* Effect.orDie(checker.digest))
    }).pipe(Effect.provide(CheckerRuntime.layer(options)))
  }).pipe(Effect.orDie, Effect.provide(FILE_PORTS))

const digestOutcomeOf = (
  directory: string,
  checkerOptions?: Readonly<Record<string, S.Json | object>>,
): Effect.Effect<Exit.Exit<string, never>, never, never> =>
  Effect.exit(digestOf(directory, checkerOptions).pipe(Effect.provide(FILE_PORTS)))

const DIGEST_SHAPE = /^[0-9a-f]{64}$/u

const digestTwice = (
  directory: string,
  between: (directory: string) => Effect.Effect<void, never, never>,
): Effect.Effect<{ readonly first: string; readonly second: string }, never, never> =>
  Effect.gen(function*() {
    const first = yield* digestOf(directory)
    yield* between(directory)
    const second = yield* digestOf(directory)
    return { first, second }
  })

const withWorkspace = <A>(
  use: (workspace: Workspace) => Effect.Effect<A, never, never>,
  files?: Readonly<Record<string, string>>,
): Effect.Effect<A, never, never> =>
  Effect.gen(function*() {
    const workspace = yield* writeWorkspace(files)
    return yield* use(workspace).pipe(Effect.ensuring(removeWorkspace(workspace.directory)))
  }).pipe(Effect.orDie, Effect.provide(FILE_PORTS))

const withTwoWorkspaces = <A>(
  use: (first: Workspace, second: Workspace) => Effect.Effect<A, never, never>,
): Effect.Effect<A, never, never> =>
  Effect.gen(function*() {
    const first = yield* writeWorkspace()
    const second = yield* writeWorkspace()
    return yield* use(first, second).pipe(
      Effect.ensuring(
        Effect.all([removeWorkspace(first.directory), removeWorkspace(second.directory)], { discard: true }),
      ),
    )
  }).pipe(Effect.orDie, Effect.provide(FILE_PORTS))

Feature('Identifying the TypeScript program a checker loaded', { timeout: 120_000 })
  .withLayer(FILE_PORTS)
  .live('one real TypeScript checker runtime over a real program on disk')
  .body(({ scenario }) => {
    scenario(
      'the digest of an unchanged program is stable and shaped like a digest',
      Gherkin.Do.pipe(
        Given('a program whose mutated module reaches a declaration through another module')(
          'observed',
          () => withWorkspace((workspace) => digestTwice(workspace.directory, () => Effect.void)),
        ),
        Then('both digests are the same 64-character lowercase hexadecimal digest')((s, expect) =>
          expect({
            shape: DIGEST_SHAPE.test(s.observed.first) && DIGEST_SHAPE.test(s.observed.second),
            stable: s.observed.first === s.observed.second,
          }).toEqual({ shape: true, stable: true })
        ),
      ),
    )

    scenario(
      'editing a declaration the mutated module only reaches transitively moves the digest',
      Gherkin.Do.pipe(
        Given('a program whose declaration file is loaded through another module')(
          'observed',
          () =>
            withWorkspace((workspace) =>
              digestTwice(workspace.directory, (directory) => appendComment(directory, DECLARATION_FILE))
            ),
        ),
        Then('the digest moves')((s, expect) =>
          expect({ moved: s.observed.first !== s.observed.second }).toEqual({ moved: true })
        ),
      ),
    )

    scenario(
      'editing the tsconfig moves the digest',
      Gherkin.Do.pipe(
        Given('a program configured by a tsconfig')(
          'observed',
          () =>
            withWorkspace((workspace) =>
              digestTwice(
                workspace.directory,
                (directory) => rewriteFile(directory, TSCONFIG_FILE, STRICT_TSCONFIG_SOURCE),
              )
            ),
        ),
        Then('the digest moves')((s, expect) =>
          expect({ moved: s.observed.first !== s.observed.second }).toEqual({ moved: true })
        ),
      ),
    )

    scenario(
      'editing a source file the program never loads leaves the digest alone',
      Gherkin.Do.pipe(
        Given('a program whose tsconfig includes only its source directory')(
          'observed',
          () =>
            withWorkspace((workspace) =>
              digestTwice(
                workspace.directory,
                (directory) => rewriteFile(directory, OUTSIDE_FILE, `${OUTSIDE_SOURCE}// edited between runs\n`),
              )
            ),
        ),
        Then('the digest is unchanged')((s, expect) =>
          expect({ stable: s.observed.first === s.observed.second }).toEqual({ stable: true })
        ),
      ),
    )

    scenario(
      'editing a base tsconfig the root extends moves the digest',
      Gherkin.Do.pipe(
        Given('a program whose tsconfig extends a sibling base config')(
          'observed',
          () =>
            withWorkspace(
              (workspace) =>
                digestTwice(
                  workspace.directory,
                  (directory) => rewriteFile(directory, BASE_TSCONFIG_FILE, CHANGED_BASE_TSCONFIG_SOURCE),
                ),
              {
                ...DEFAULT_FILES,
                [TSCONFIG_FILE]: EXTENDS_TSCONFIG_SOURCE,
                [BASE_TSCONFIG_FILE]: BASE_TSCONFIG_SOURCE,
              },
            ),
        ),
        Then('the digest moves')((s, expect) =>
          expect({ moved: s.observed.first !== s.observed.second }).toEqual({ moved: true })
        ),
      ),
    )

    scenario(
      'editing a base tsconfig the root extends by package specifier moves the digest',
      Gherkin.Do.pipe(
        Given('a program whose tsconfig extends a base config through node_modules')(
          'observed',
          () =>
            withWorkspace(
              (workspace) =>
                digestTwice(
                  workspace.directory,
                  (directory) => rewriteFile(directory, PACKAGE_BASE_TSCONFIG_FILE, CHANGED_BASE_TSCONFIG_SOURCE),
                ),
              {
                ...DEFAULT_FILES,
                [TSCONFIG_FILE]: PACKAGE_EXTENDS_TSCONFIG_SOURCE,
                [PACKAGE_BASE_TSCONFIG_FILE]: BASE_TSCONFIG_SOURCE,
              },
            ),
        ),
        Then('the digest moves')((s, expect) =>
          expect({ moved: s.observed.first !== s.observed.second }).toEqual({ moved: true })
        ),
      ),
    )

    scenario(
      'the same program copied into two temporary directories has one digest',
      Gherkin.Do.pipe(
        Given('two copies of one program under different temporary directories')(
          'observed',
          () =>
            withTwoWorkspaces((first, second) =>
              Effect.gen(function*() {
                const firstDigest = yield* digestOf(first.directory)
                const secondDigest = yield* digestOf(second.directory)
                return { firstDigest, secondDigest }
              })
            ),
        ),
        Then('both copies have the same digest')((s, expect) =>
          expect({ equal: s.observed.firstDigest === s.observed.secondDigest }).toEqual({ equal: true })
        ),
      ),
    )

    scenario(
      'the same checker options in a different key order keep one digest',
      Gherkin.Do.pipe(
        Given('one program digested with semantically equal checker options')(
          'observed',
          () =>
            withWorkspace((workspace) =>
              Effect.gen(function*() {
                const first = yield* digestOf(workspace.directory, { alpha: 1, beta: 2 })
                const second = yield* digestOf(workspace.directory, { beta: 2, alpha: 1 })
                return { first, second }
              })
            ),
        ),
        Then('both digests are the same')((s, expect) =>
          expect({ equal: s.observed.first === s.observed.second }).toEqual({ equal: true })
        ),
      ),
    )

    scenario(
      'checker options that cannot be encoded yield no digest',
      Gherkin.Do.pipe(
        Given('a program digested with a checker option that is not JSON')(
          'observed',
          () =>
            withWorkspace((workspace) =>
              Effect.map(digestOutcomeOf(workspace.directory, { probe: () => 1 }), (outcome) => ({
                failed: Exit.isFailure(outcome),
              }))
            ),
        ),
        Then('the digest request fails')((s, expect) => expect(s.observed).toEqual({ failed: true })),
      ),
    )
  })
