import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { expect } from 'vitest'

import { CheckFinished, checkMutants } from '../src/check-mutants.workflow.js'
import { CheckMutantsInput, type DiagnosticDecoded, type NodeDecodedShape } from '../src/CheckMutants.schema.js'
import { check, close, init, make, nodes } from '../src/ts-compiler.handle.js'
const Feature = makeFeature({ it, layer })

const nodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

interface ProjectTree {
  readonly tsconfigFile: string
  readonly files: ReadonlyArray<readonly [relativePath: string, content: string]>
}

const packageJson = (name: string) => JSON.stringify({ name, version: '1.2.3', type: 'module' }, null, 2)

const brokenSource = (exportedName: string) => `export const ${exportedName}: number = 'not a number'\n`

const manifestImportingSource = `import pkg from '../package.json'\n\nexport const version: string = pkg.version\n`

const singleProjectTree: ProjectTree = {
  tsconfigFile: 'tsconfig.json',
  files: [
    [
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: { noEmit: true, resolveJsonModule: true },
          include: ['src', 'package.json'],
        },
        null,
        2,
      ),
    ],
    ['package.json', packageJson('single-cli')],
    ['src/cli-version.ts', manifestImportingSource],
    ['drafts/legacy.ts', brokenSource('legacy')],
  ],
}

const compositeTree: ProjectTree = {
  tsconfigFile: 'tsconfig.app.json',
  files: [
    [
      'tsconfig.app.json',
      JSON.stringify(
        {
          compilerOptions: { noEmit: true, resolveJsonModule: true },
          include: ['src', 'package.json'],
          references: [{ path: './lib' }],
        },
        null,
        2,
      ),
    ],
    ['package.json', packageJson('composite-cli')],
    [
      'src/cli-version.ts',
      `import pkg from '../package.json'\nimport { libValue } from '../lib/src/index.js'\n\nexport const version: string = pkg.version\nexport const answer: number = libValue()\n`,
    ],
    ['drafts/legacy.ts', brokenSource('legacy')],
    [
      'lib/tsconfig.json',
      JSON.stringify({ compilerOptions: { composite: true }, include: ['src'] }, null, 2),
    ],
    ['lib/src/index.ts', `export const libValue = (): number => 42\n`],
  ],
}

const strictLibraryTree: ProjectTree = {
  tsconfigFile: 'tsconfig.app.json',
  files: [
    [
      'tsconfig.app.json',
      JSON.stringify(
        {
          compilerOptions: { noEmit: true, resolveJsonModule: true },
          include: ['src', 'package.json'],
          references: [{ path: './lib' }],
        },
        null,
        2,
      ),
    ],
    ['package.json', packageJson('strict-referenced-cli')],
    [
      'src/cli-version.ts',
      `import pkg from '../package.json'\nimport { libValue } from '../lib/src/index.js'\n\nexport const version: string = pkg.version\nexport const answer: number = libValue()\n`,
    ],
    [
      'lib/tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: { composite: true, noUnusedLocals: true },
          files: ['src/index.ts'],
        },
        null,
        2,
      ),
    ],
    ['lib/src/index.ts', `const leftovers = 'unused'\nexport const libValue = (): number => 42\n`],
    ['lib/src/broken.ts', brokenSource('broken')],
  ],
}

const presetProjectTree: ProjectTree = {
  tsconfigFile: 'tsconfig.json',
  files: [
    ['tsconfig.preset.json', JSON.stringify({ compilerOptions: { noUncheckedIndexedAccess: true } }, null, 2)],
    ['tsconfig.json', JSON.stringify({ extends: './tsconfig.preset.json', include: ['src'] }, null, 2)],
    ['src/first.ts', `export const firstOr = (values: ReadonlyArray<string>): string =>\n  values[0] ?? 'none'\n`],
  ],
}

interface MutantSpec {
  readonly id: string
  readonly relativeFile: string
  readonly replacement: string
  readonly location: {
    readonly start: { line: number; column: number }
    readonly end: { line: number; column: number }
  }
}

const fallbackDrop: MutantSpec = {
  id: 'fallback-drop',
  relativeFile: 'src/first.ts',
  replacement: 'values[0]',
  location: { start: { line: 2, column: 3 }, end: { line: 2, column: 22 } },
}

const materialize = (tree: ProjectTree) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectory({ prefix: 'tsconfig-rewrite-pin-91c3-' })
    yield* Effect.forEach(
      tree.files,
      ([relativePath, content]) =>
        Effect.gen(function*() {
          const target = path.join(dir, relativePath)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    return { dir, tsconfigFile: path.join(dir, tree.tsconfigFile) }
  })

const compileProject = (
  project: { readonly dir: string; readonly tsconfigFile: string },
  mutants: ReadonlyArray<MutantSpec>,
) =>
  Effect.gen(function*() {
    const host = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const options = yield* Effect.orDie(
      S.decodeEffect(Options.StrykerOptionsSchema)({ tsconfigFile: project.tsconfigFile }),
    )
    const compiler = make(options, { host, pathService: path })
    const dryRun = yield* init(compiler)
    const graphNodes = yield* nodes(compiler)
    const wires = mutants.map((spec) =>
      Checker.CheckerMutantWire.make({
        id: Mutant.MutantId.make(spec.id),
        fileName: Mutant.CanonicalFileName.make(path.join(project.dir, spec.relativeFile)),
        mutatorName: Mutant.MutatorName.make('MethodExpression'),
        replacement: spec.replacement,
        location: spec.location,
      })
    )
    const mutantDiagnostics = yield* check(compiler, wires)
    yield* close(compiler)
    return { dryRun, mutantDiagnostics, graphNodes, wires }
  })

const compileThenCleanUp = (
  project: { readonly dir: string; readonly tsconfigFile: string },
  mutants: ReadonlyArray<MutantSpec>,
) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.ensuring(
      compileProject(project, mutants),
      Effect.orDie(fs.remove(project.dir, { recursive: true })),
    ))

const verdictFor = (outcome: {
  readonly graphNodes: Iterable<readonly [string, NodeDecodedShape]>
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
  readonly mutantDiagnostics: ReadonlyArray<DiagnosticDecoded>
}) =>
  checkMutants(
    CheckMutantsInput.make({
      mutants: [...outcome.wires],
      diagnostics: [...outcome.mutantDiagnostics],
      nodes: Object.fromEntries(outcome.graphNodes),
    }),
  )

Feature('Checking mutants with the project own tsconfig rules in force')
  .withLayer(nodeFsPathLayer)
  .body(({ scenario }) => {
    scenario(
      'A single project that imports its package manifest compiles in the dry run',
      Gherkin.Do.pipe(
        Given('a single project that lists its package manifest among the files it compiles and imports it')(
          'project',
          () => materialize(singleProjectTree),
        ),
        When('the checker prepares the project for mutant checking')(
          'outcome',
          (s) => compileThenCleanUp(s.project, []),
        ),
        Then('the preparation compile reports no errors')((s) => {
          expect(s.outcome.dryRun).toEqual([])
        }),
      ),
    )

    scenario(
      'A composite project that imports its package manifest compiles in the dry run',
      Gherkin.Do.pipe(
        Given(
          'a composite project whose application config lists its package manifest among the files it compiles, imports it, and references a library project',
        )('project', () => materialize(compositeTree)),
        When('the checker prepares the project for mutant checking')(
          'outcome',
          (s) => compileThenCleanUp(s.project, []),
        ),
        Then('the preparation compile reports no errors')((s) => {
          expect(s.outcome.dryRun).toEqual([])
        }),
      ),
    )

    scenario(
      'A referenced project is checked under the checker own compiler option overrides',
      Gherkin.Do.pipe(
        Given(
          'a composite project whose library opts into unused variable checking, keeps an unused variable, and leaves a broken file outside the files it compiles',
        )('project', () => materialize(strictLibraryTree)),
        When('the checker prepares the project for mutant checking')(
          'outcome',
          (s) => compileThenCleanUp(s.project, []),
        ),
        Then('the preparation compile reports no errors')((s) => {
          expect(s.outcome.dryRun).toEqual([])
        }),
      ),
    )

    scenario(
      'A mutant that breaks a rule inherited from a shared preset is a compile error',
      Gherkin.Do.pipe(
        Given('a project that extends a preset that turns on unchecked indexed access')(
          'project',
          () => materialize(presetProjectTree),
        ),
        When('the checker verifies a mutant that drops the fallback for a missing element')(
          'outcome',
          (s) => compileThenCleanUp(s.project, [fallbackDrop]),
        ),
        Then('the dry run reports no compile errors')((s) => {
          expect(s.outcome.dryRun).toEqual([])
        }),
        Then('the mutant is reported as a compile error')((s) => {
          const mutantResult = Result.match(verdictFor(s.outcome), {
            onFailure: () => undefined,
            onSuccess: (decision) => S.is(CheckFinished)(decision) ? decision.results[fallbackDrop.id] : undefined,
          })
          expect(mutantResult?.status).toBe('compileError')
          expect(mutantResult?.status === 'compileError' ? mutantResult.reason : undefined).toContain(
            "Type 'string | undefined' is not assignable to type 'string'",
          )
        }),
      ),
    )
  })
