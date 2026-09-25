import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Instrument, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe } from '@systemfsoftware/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import {
  CheckerRuntime,
  type CheckerRuntimeShape,
} from '../../../packages/stryker-js-typescript-checker/src/CheckerRuntime.service.js'
import { nodes } from '../../../packages/stryker-js-typescript-checker/src/ts-compiler.handle.js'
import { TypeScriptCompiler } from '../../../packages/stryker-js-typescript-checker/src/ts-compiler.service.js'

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
    'testResources',
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

const wireOf = (mutant: Mutant.Mutant): Checker.CheckerMutantWire => ({
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
    const instrumented = yield* Instrument.instrument(files, {
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
  readonly runtime: CheckerRuntimeShape
  readonly start: Result.Result<void, Cause.Cause<Checker.CheckerFailed>>
  readonly projectFiles: ReadonlyArray<string>
}

const optionsFor = (layout: FixtureLayout): Effect.Effect<Options.StrykerOptions, S.SchemaError> =>
  S.decodeEffect(Options.StrykerOptionsSchema)({ tsconfigFile: layout.projectTsConfig })

const rigLayers = (
  layout: FixtureLayout,
): Layer.Layer<CheckerRuntime | TypeScriptCompiler, never, FileSystem.FileSystem | Path.Path> =>
  Layer.unwrap(
    Effect.map(Effect.orDie(optionsFor(layout)), (options) => CheckerRuntime.layer(options)),
  )

const checkerRig = (
  layout: FixtureLayout,
): Effect.Effect<CheckerRig, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.flatMap(Layer.build(rigLayers(layout)), (context) =>
    Effect.gen(function*() {
      const runtime = yield* CheckerRuntime
      const compiler = yield* TypeScriptCompiler
      const service = yield* Effect.result(runtime.checker)
      const graph = yield* nodes(compiler)
      return {
        layout,
        runtime,
        start: Result.map(service, () => undefined),
        projectFiles: [...HashMap.keys(graph)],
      }
    }).pipe(Effect.provideContext(context))).pipe(Effect.orDie)

const withChecker = <A, E, R>(
  rig: CheckerRig,
  use: (checker: Checker.Checker['Service']) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Cause.Cause<Checker.CheckerFailed>, R> => Effect.flatMap(rig.runtime.checker, use)

const startComplaints = (start: Result.Result<void, Cause.Cause<Checker.CheckerFailed>>): ReadonlyArray<string> =>
  Result.match(start, {
    onFailure: (cause) => [Cause.pretty(cause)],
    onSuccess: () => [],
  })

const faultReports = (
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
  results: HashMap.HashMap<string, Checker.CheckResult>,
  refused: (result: Checker.CheckResult) => result is Checker.FailedCheckResult,
): ReadonlyArray<string> =>
  wires.flatMap((wire) =>
    Option.match(HashMap.get(results, wire.id), {
      onNone: () => [`no verdict was reached for the fault at ${wire.fileName}:${wire.location.start.line + 1}`],
      onSome: (result) =>
        refused(result)
          ? [
            `the fault at ${wire.fileName}:${wire.location.start.line + 1} replacing with \`${wire.replacement}\`` +
            ` was refused: ${result.reason}`,
          ]
          : [],
    })
  )

const problemReports = (
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
  results: HashMap.HashMap<string, Checker.CheckResult>,
): ReadonlyArray<string> => faultReports(wires, results, notPassed)

const refusalReports = (
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
  results: HashMap.HashMap<string, Checker.CheckResult>,
): ReadonlyArray<string> => faultReports(wires, results, compilationRefused)

const notPassed = (result: Checker.CheckResult): result is Checker.FailedCheckResult => result.status !== 'passed'

const compilationRefused = (result: Checker.CheckResult): result is Checker.FailedCheckResult =>
  result.status === 'compileError'

const illTypedControl = (wires: ReadonlyArray<Checker.CheckerMutantWire>): Option.Option<Checker.CheckerMutantWire> =>
  Option.map(
    Option.fromUndefinedOr(wires.find((wire) => wire.fileName.endsWith('import-style-named.ts'))),
    (wire) => ({ ...wire, replacement: '1' }),
  )

describe('The TypeScript checker accepting opted-in concurrency faults', (it) => {
  it.live('the untouched definitions project is accepted without a complaint', function*({ expect }) {
    const observed = yield* Effect.gen(function*() {
      const rig = yield* Effect.flatMap(fixtureLayout, checkerRig)
      const inspected: Record<string, true> = {}
      rig.projectFiles.forEach((fileName) => {
        inspected[fileName] = true
      })
      return {
        startComplaints: startComplaints(rig.start),
        uninspectedDefinitionFiles: rig.layout.definitionFiles.filter((fileName) => inspected[fileName] !== true),
      }
    }).pipe(Effect.scoped, Effect.provide(runLayer))

    yield* expect(observed).toStrictEqual({ startComplaints: [], uninspectedDefinitionFiles: [] })
  })

  it.live('every proposed concurrency fault compiles like the code it replaces', function*({ expect }) {
    const observed = yield* Effect.gen(function*() {
      const rig = yield* Effect.flatMap(fixtureLayout, checkerRig)
      const wires = yield* instrumentedWires(rig.layout)
      const results = yield* withChecker(rig, (checker) => checker.check(wires))
      return { wireCount: wires.length, problemReports: problemReports(wires, results) }
    }).pipe(Effect.scoped, Effect.provide(runLayer))

    yield* expect(observed).toStrictEqual({ wireCount: expectedMutantCount(), problemReports: [] })
  })

  it.live('a fault that breaks the typing is refused as a compile problem', function*({ expect }) {
    const observed = yield* Effect.gen(function*() {
      const rig = yield* Effect.flatMap(fixtureLayout, checkerRig)
      const wires = yield* instrumentedWires(rig.layout)
      return yield* Option.match(illTypedControl(wires), {
        onNone: () =>
          Effect.fail(
            MissingControlFault.make({ reason: 'no fault on an effect-returning expression was proposed' }),
          ),
        onSome: (control) =>
          Effect.map(
            withChecker(rig, (checker) => checker.check([control])),
            (results) => refusalReports([control], results),
          ),
      })
    }).pipe(Effect.scoped, Effect.provide(runLayer))

    yield* expect(observed).toStrictEqual([expect.stringMatching(/\S/)])
  })
})
