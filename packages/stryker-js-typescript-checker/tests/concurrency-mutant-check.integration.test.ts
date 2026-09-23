import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type {
  Checker,
  CheckerFailed,
  CheckerMutantWire,
  CheckResult,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { expect } from 'vitest'

import { makeCheckerService } from '../src/Checker.js'
import { makeHybridFileSystem, makeTypescriptCompiler } from '../src/Compiler.js'

const Feature = makeFeature({ it, layer })

const LIVE_OPT_IN_MUTATIONS: readonly string[] = [
  'AtomicUpdateSplit',
  'SynchronizationRemoval',
  'FinalizerEscape',
]

const EXPECTED_MUTANTS_BY_MUTATOR: Record<string, number> = {
  AtomicUpdateSplit: 42,
  FinalizerEscape: 20,
  SynchronizationRemoval: 11,
}

const expectedMutantCount = (): number =>
  LIVE_OPT_IN_MUTATIONS.reduce((total, mutatorName) => total + (EXPECTED_MUTANTS_BY_MUTATOR[mutatorName] ?? 0), 0)

const runLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

interface FixtureLayout {
  readonly definitionFiles: ReadonlyArray<string>
  readonly projectTsConfig: string
}

const fixtureLayout = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const testDirectory = path.dirname(yield* path.fromFileUrl(new URL(import.meta.url)))
  const definitionsDirectory = path.join(
    testDirectory,
    '..',
    '..',
    'stryker-js-instrumenter',
    'tests',
    '__fixtures__',
    'effect-concurrency',
  )
  const moduleNames = yield* fs.readDirectory(definitionsDirectory)
  return {
    definitionFiles: moduleNames
      .filter((moduleName) => moduleName.endsWith('.ts'))
      .map((moduleName) => path.join(definitionsDirectory, moduleName)),
    projectTsConfig: path.join(testDirectory, '__fixtures__', 'effect-concurrency', 'tsconfig.json'),
  }
})

const wireOf = (mutant: Mutant): CheckerMutantWire => ({
  id: mutant.id,
  fileName: mutant.fileName,
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  location: mutant.location,
})

const instrumentedWires = (layout: FixtureLayout) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const files = yield* Effect.forEach(layout.definitionFiles, (fileName) =>
      Effect.map(fs.readFileString(fileName), (content) => ({ name: fileName, content, mutate: true })))
    const instrumented = yield* instrument(files, {
      ignorers: [],
      excludedMutations: [],
      optInMutations: [...LIVE_OPT_IN_MUTATIONS],
    })
    return instrumented.mutants
      .filter((mutant) =>
        LIVE_OPT_IN_MUTATIONS.includes(mutant.mutatorName)
      )
      .map(wireOf)
  })

interface CheckerRig {
  readonly layout: FixtureLayout
  readonly checker: Checker['Service']
  readonly start: Result.Result<void, CheckerFailed>
  readonly projectFiles: ReadonlyArray<string>
}

const checkerRig = (layout: FixtureLayout) =>
  Effect.gen(function*() {
    const fsService = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const options = yield* S.decodeEffect(StrykerOptionsSchema)({ tsconfigFile: layout.projectTsConfig })
    const fs = yield* makeHybridFileSystem(fsService)
    const compiler = makeTypescriptCompiler(options, fs, fsService, pathService)
    const checker = makeCheckerService({ options, compiler })
    const start = yield* Effect.result(checker.init)
    const nodes = yield* compiler.nodes
    return {
      checker,
      layout,
      projectFiles: Array.from(MutableHashMap.keys(nodes)),
      start,
    }
  })

const startComplaints = (start: Result.Result<void, CheckerFailed>): ReadonlyArray<string> =>
  Result.match(start, {
    onFailure: (failure) => [failure.cause],
    onSuccess: () => [],
  })

const problemReports = (
  wires: ReadonlyArray<CheckerMutantWire>,
  results: HashMap.HashMap<string, CheckResult>,
): ReadonlyArray<string> =>
  wires.flatMap((wire) =>
    Option.match(HashMap.get(results, wire.id), {
      onNone: () => [`no verdict was reached for the fault at ${wire.fileName}:${wire.location.start.line + 1}`],
      onSome: (result) =>
        result.status === 'passed'
          ? []
          : [
            `the fault at ${wire.fileName}:${wire.location.start.line + 1} replacing with \`${wire.replacement}\`` +
            ` was refused: ${result.reason}`,
          ],
    })
  )

const refusalReports = (
  wires: ReadonlyArray<CheckerMutantWire>,
  results: HashMap.HashMap<string, CheckResult>,
): ReadonlyArray<string> =>
  wires.flatMap((wire) =>
    Option.match(HashMap.get(results, wire.id), {
      onNone: () => [`no verdict was reached for the fault at ${wire.fileName}:${wire.location.start.line + 1}`],
      onSome: (result) =>
        result.status === 'compileError'
          ? [
            `the fault at ${wire.fileName}:${wire.location.start.line + 1} replacing with \`${wire.replacement}\`` +
            ` was refused: ${result.reason}`,
          ]
          : [],
    })
  )

const illTypedControl = (wires: ReadonlyArray<CheckerMutantWire>): Option.Option<CheckerMutantWire> =>
  Option.map(
    Option.fromUndefinedOr(wires.find((wire) => wire.fileName.endsWith('import-style-named.ts'))),
    (wire) => ({ ...wire, replacement: '1' }),
  )

Feature('The TypeScript checker accepting opted-in concurrency faults')
  .withLayer(runLayer)
  .body(({ scenario }) => {
    scenario(
      'The untouched definitions project is accepted without a complaint',
      Gherkin.Do.pipe(
        Given('a strict project around the Effect concurrency definitions')(
          'rig',
          () => Effect.flatMap(fixtureLayout, checkerRig),
        ),
        When('the checker inspects the project as it was written')(
          'complaints',
          (s) => Effect.succeed(startComplaints(s.rig.start)),
        ),
        Then('no compile problem is reported')((s) => {
          expect(s.complaints).toEqual([])
        }),
        Then('every definition module is part of the inspected project')((s) => {
          const inspected: Record<string, true> = {}
          s.rig.projectFiles.forEach((fileName) => {
            inspected[fileName] = true
          })
          expect(s.rig.layout.definitionFiles.filter((fileName) => inspected[fileName] !== true)).toEqual([])
        }),
      ),
    )

    scenario(
      'Every proposed concurrency fault compiles like the code it replaces',
      Gherkin.Do.pipe(
        Given('a strict project around the Effect concurrency definitions')(
          'rig',
          () => Effect.flatMap(fixtureLayout, checkerRig),
        ),
        Given('the faults proposed for those definitions')('wires', (s) => instrumentedWires(s.rig.layout)),
        When('the checker inspects every fault')('results', (s) => s.rig.checker.check(s.wires)),
        Then('the proposal matches what the definitions promise')((s) => {
          expect(s.wires.length).toBe(expectedMutantCount())
        }),
        Then('every fault keeps the original typing')((s) => {
          expect(problemReports(s.wires, s.results)).toEqual([])
        }),
      ),
    )

    scenario(
      'A fault that breaks the typing is refused',
      Gherkin.Do.pipe(
        Given('a strict project around the Effect concurrency definitions')(
          'rig',
          () => Effect.flatMap(fixtureLayout, checkerRig),
        ),
        Given('the faults proposed for those definitions')('wires', (s) => instrumentedWires(s.rig.layout)),
        When('one fault replaces an effect with a plain number')(
          'refusals',
          (s) =>
            Option.match(illTypedControl(s.wires), {
              onNone: () => Effect.fail(new Error('no fault on an effect-returning expression was proposed')),
              onSome: (control) =>
                Effect.map(s.rig.checker.check([control]), (results) => refusalReports([control], results)),
            }),
        ),
        Then('the checker refuses that fault as a compile problem')((s) => {
          expect(s.refusals).toHaveLength(1)
        }),
      ),
    )
  })
