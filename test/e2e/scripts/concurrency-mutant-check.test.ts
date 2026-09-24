import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { instrument } from '@systemfsoftware/stryker-js-instrumenter'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { StrykerOptionsSchema } from '../../../packages/stryker-js-plugin-interface/src/index.js'
import type {
  CheckerFailed,
  CheckerMutantWire,
  CheckResult,
} from '../../../packages/stryker-js-plugin-interface/src/index.js'
import { makeCheckerService } from '../../../packages/stryker-js-typescript-checker/src/Checker.js'
import {
  makeHybridFileSystem,
  makeTypescriptCompiler,
} from '../../../packages/stryker-js-typescript-checker/src/Compiler.js'

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
    '..',
    'packages',
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
    projectTsConfig: path.join(testDirectory, 'oracle', 'effect-concurrency', 'tsconfig.json'),
  }
})

class MissingControlFault extends S.TaggedError<MissingControlFault>()('MissingControlFault', {
  reason: S.String,
}) {}

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

describe('The TypeScript checker accepting opted-in concurrency faults', () => {
  it('the untouched definitions project is accepted without a complaint', () =>
    Effect.runPromise(
      Effect.gen(function*() {
        const rig = yield* Effect.flatMap(fixtureLayout, checkerRig)
        expect(startComplaints(rig.start)).toEqual([])
        const inspected: Record<string, true> = {}
        rig.projectFiles.forEach((fileName) => {
          inspected[fileName] = true
        })
        expect(rig.layout.definitionFiles.filter((fileName) => inspected[fileName] !== true)).toEqual([])
      }).pipe(Effect.provide(runLayer)),
    ))

  it('every proposed concurrency fault compiles like the code it replaces', () =>
    Effect.runPromise(
      Effect.gen(function*() {
        const rig = yield* Effect.flatMap(fixtureLayout, checkerRig)
        const wires = yield* instrumentedWires(rig.layout)
        const results = yield* rig.checker.check(wires)
        expect(wires.length).toBe(expectedMutantCount())
        expect(problemReports(wires, results)).toEqual([])
      }).pipe(Effect.provide(runLayer)),
    ))

  it('a fault that breaks the typing is refused as a compile problem', () =>
    Effect.runPromise(
      Effect.gen(function*() {
        const rig = yield* Effect.flatMap(fixtureLayout, checkerRig)
        const wires = yield* instrumentedWires(rig.layout)
        const refusals = yield* Option.match(illTypedControl(wires), {
          onNone: () =>
            Effect.fail(
              MissingControlFault.make({ reason: 'no fault on an effect-returning expression was proposed' }),
            ),
          onSome: (control) =>
            Effect.map(rig.checker.check([control]), (results) => refusalReports([control], results)),
        })
        expect(refusals).toHaveLength(1)
      }).pipe(Effect.provide(runLayer)),
    ))
})
