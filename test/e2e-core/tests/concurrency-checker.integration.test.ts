import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  CheckerRuntime,
  type CheckerRuntimeShape,
  nodes,
  TypeScriptCompiler,
} from '@systemfsoftware/stryker-js-typescript-checker/runtime'
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
import { Project } from 'ts-morph'
import { analyzeFileWithTsMorph } from './__fixtures__/ast-analyzer.js'
import { determineCompileErrorsWithDiagnostics, evaluateWithProjects } from './__fixtures__/diagnostics.js'

const Feature = makeFeature({ it })

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
    projectTsConfig: path.join(testDirectory, '__fixtures__', 'effect-concurrency', 'tsconfig.json'),
  }
})

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
      mutators: Mutator.selectMutators(Mutator.stockRegistry, LIVE_OPT_IN_MUTATIONS),
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
    optionsFor(layout).pipe(
      Effect.orDie,
      Effect.map((options) => CheckerRuntime.layer(options)),
    ),
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

Feature('The TypeScript checker accepting opted-in concurrency faults')
  .withLayer(runLayer)
  .live('the rig drives the real TS7 checker runtime over the instrumented concurrency definitions')
  .body(({ scenario }) => {
    scenario(
      'An untouched definitions project is accepted without a complaint',
      Gherkin.Do.pipe(
        When('the definitions project is handed to the checker runtime')('observed', () =>
          Effect.gen(function*() {
            const rig = yield* Effect.flatMap(fixtureLayout, checkerRig)
            const inspected: Record<string, boolean> = {}
            rig.projectFiles.forEach((fileName) => {
              inspected[fileName] = true
            })
            return {
              startComplaints: startComplaints(rig.start),
              uninspectedDefinitionFiles: rig.layout.definitionFiles.filter((fileName) => inspected[fileName] !== true),
            }
          }).pipe(Effect.scoped)),
        Then('the start reports nothing and every definition file is in the program')((s, expect) => {
          return expect(s.observed).toStrictEqual({ startComplaints: [], uninspectedDefinitionFiles: [] })
        }),
      ),
    )

    scenario(
      'Every proposed concurrency fault compiles like the code it replaces',
      Gherkin.Do.pipe(
        When('each fault the instrumenter proposes is submitted')('observed', () =>
          Effect.gen(function*() {
            const rig = yield* Effect.flatMap(fixtureLayout, checkerRig)
            const wires = yield* instrumentedWires(rig.layout)
            const results = yield* withChecker(rig, (checker) => checker.check(wires))
            return { wireCount: wires.length, problemReports: problemReports(wires, results) }
          }).pipe(Effect.scoped)),
        Then('the checker reaches a verdict for every fault and refuses none of them')((s, expect) => {
          return expect(s.observed).toStrictEqual({ wireCount: expectedMutantCount(), problemReports: [] })
        }),
      ),
    )

    scenario(
      'A fault that breaks the typing is refused as a compile problem',
      Gherkin.Do.pipe(
        When('a proposed fault is replaced by a payload that cannot type')('observed', () =>
          Effect.gen(function*() {
            const rig = yield* Effect.flatMap(fixtureLayout, checkerRig)
            const wires = yield* instrumentedWires(rig.layout)
            return yield* Option.match(illTypedControl(wires), {
              onNone: () =>
                Effect.succeed<{ readonly faultProposed: boolean; readonly refusals: ReadonlyArray<string> }>({
                  faultProposed: false,
                  refusals: [],
                }),
              onSome: (control) =>
                Effect.map(
                  withChecker(rig, (checker) => checker.check([control])),
                  (results) => ({ faultProposed: true, refusals: refusalReports([control], results) }),
                ),
            })
          }).pipe(Effect.scoped)),
        Then('a fault was proposed and every refusal names the compile problem')((s, expect) => {
          return expect({
            faultProposed: s.observed.faultProposed,
            everyRefusalNamesAProblem: s.observed.refusals.length > 0 &&
              s.observed.refusals.every((report) => /\S/.test(report)),
          }).toStrictEqual({ faultProposed: true, everyRefusalNamesAProblem: true })
        }),
      ),
    )

    const PROVIDER_TEXT = [
      'export interface User {',
      '  readonly id: string;',
      '  readonly name: string;',
      '}',
      'export function getUser(): User {',
      '  return { id: "1", name: "Alice" };',
      '}',
    ].join('\n')

    const CONSUMER_TEXT = [
      'import { getUser, type User } from "./provider.js";',
      'export function getGreeting(): string {',
      '  const user: User = getUser();',
      '  return "Hello, " + user.name;',
      '}',
    ].join('\n')

    const CALCULATE_TEXT = [
      'export const calculate = (x: number): number => {',
      '  if (x > 0) {',
      '    return x + 1;',
      '  }',
      '  return 0;',
      '};',
    ].join('\n')

    const DISABLED_EQUALITY_TEXT = [
      '// Stryker disable next-line EqualityOperator',
      'export const eq = (a: number, b: number): boolean => a === b;',
    ].join('\n')

    const EXCLUDED_TEXT = [
      'export const eq = (a: number, b: number): boolean => a === b;',
      'export const cond = (a: number, b: number): number => (a > b) ? a : b;',
    ].join('\n')

    const inMemoryProjectOf = (files: Readonly<Record<string, string>>): Project => {
      const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } })
      for (const [filePath, text] of Object.entries(files)) {
        project.createSourceFile(filePath, text)
      }
      return project
    }

    const packageProjectOf = (project: Project, fileNames: readonly string[]) => ({
      packageDir: '/proj',
      tsConfigPath: '/proj/tsconfig.json',
      project,
      fileNames: new Set(fileNames),
    })

    scenario(
      'A downstream type-contract break surfaces the imported-file diagnostic',
      Gherkin.Do.pipe(
        When('the provider file is mutated against the composite in-memory project')(
          'observed',
          () =>
            Effect.sync(() => {
              const providerInventory = analyzeFileWithTsMorph(PROVIDER_TEXT, [])
              const candidate = providerInventory.mutants.find((m) => m.mutatorName === 'ObjectLiteral')
              if (candidate === undefined) throw new Error('expected an ObjectLiteral mutant in the provider inventory')

              const composite = inMemoryProjectOf({
                '/proj/src/provider.ts': PROVIDER_TEXT,
                '/proj/src/consumer.ts': CONSUMER_TEXT,
              })
              const mutatedProvider = PROVIDER_TEXT.slice(0, candidate.start) +
                candidate.replacement +
                PROVIDER_TEXT.slice(candidate.end)
              const result = evaluateWithProjects(
                [packageProjectOf(composite, ['/proj/src/provider.ts', '/proj/src/consumer.ts'])],
                '/proj/src/provider.ts',
                mutatedProvider,
                [candidate],
              ).at(0)
              return { candidate, compileError: result?.compileError }
            }),
        ),
        Then('the diagnostic names the properties the imported type lost')((s, expect) => {
          return expect(s.observed).toMatchObject({
            candidate: expect.objectContaining({ mutatorName: 'ObjectLiteral' }),
            compileError: { code: 2739, message: expect.stringMatching(/missing the following properties/i) },
          })
        }),
      ),
    )

    scenario(
      'A single-file mutation surfaces its in-place diagnostic',
      Gherkin.Do.pipe(
        When('a block-bodied mutation is diagnosed in place')('observed', () =>
          Effect.sync(() => {
            const inventory = analyzeFileWithTsMorph(CALCULATE_TEXT, [])
            const withDiagnostics = determineCompileErrorsWithDiagnostics(CALCULATE_TEXT, inventory.mutants)
            return {
              code: withDiagnostics.find((m) => m.mutatorName === 'BlockStatement' && m.line === 1)?.compileError?.code,
            }
          })),
        Then('the block statement mutant is reported under the expected diagnostic code')((s, expect) => {
          return expect(s.observed.code).toBe(2355)
        }),
      ),
    )

    scenario(
      'A disabled family is Ignored and is never diagnosed',
      Gherkin.Do.pipe(
        When('an EqualityOperator mutant a directive disables is diagnosed')('observed', () =>
          Effect.sync(() => {
            const inventory = analyzeFileWithTsMorph(DISABLED_EQUALITY_TEXT, [])
            const eqMutant = inventory.mutants.find((m) => m.mutatorName === 'EqualityOperator')
            if (eqMutant === undefined) throw new Error('expected an Ignored EqualityOperator mutant')

            const diagnosed = determineCompileErrorsWithDiagnostics(DISABLED_EQUALITY_TEXT, [eqMutant]).at(0)
            return {
              status: eqMutant.status,
              ignoredCount: inventory.ignoredCount,
              diagnosed: diagnosed?.compileError,
            }
          })),
        Then('the mutant stays Ignored and carries no diagnostic')((s, expect) => {
          return expect(s.observed).toStrictEqual({ status: 'Ignored', ignoredCount: 1, diagnosed: undefined })
        }),
      ),
    )

    scenario(
      'A source with no mutable node yields an empty inventory',
      Gherkin.Do.pipe(
        When('a module whose only statement is an unmutatable declaration is analyzed')(
          'observed',
          () =>
            Effect.sync(() => {
              const inventory = analyzeFileWithTsMorph('export const nothing: number = 1;', [])
              return {
                mutants: inventory.mutants,
                activeCount: inventory.activeCount,
                ignoredCount: inventory.ignoredCount,
              }
            }),
        ),
        Then('the inventory is empty on every count')((s, expect) => {
          return expect(s.observed).toEqual({ mutants: [], activeCount: 0, ignoredCount: 0 })
        }),
      ),
    )

    scenario(
      'An excluded family is Ignored and still tallied, never dropped',
      Gherkin.Do.pipe(
        When('three families are excluded from an analysis of two comparisons')('observed', () =>
          Effect.sync(() => {
            const excluded = ['EqualityOperator', 'ConditionalExpression', 'ArrowFunction']
            const inventory = analyzeFileWithTsMorph(EXCLUDED_TEXT, excluded)
            return {
              everyExcludedFamilyTallied: excluded.every((family) => (inventory.mutatorTally[family] ?? 0) > 0),
              statuses: [...new Set(inventory.mutants.map((m) => m.status))].join(','),
              diagnosed: determineCompileErrorsWithDiagnostics(EXCLUDED_TEXT, inventory.mutants)
                .some((m) => m.compileError !== undefined),
            }
          })),
        Then('every excluded family is tallied as Ignored and none is diagnosed')((s, expect) => {
          return expect(s.observed).toStrictEqual({
            everyExcludedFamilyTallied: true,
            statuses: 'Ignored',
            diagnosed: false,
          })
        }),
      ),
    )

    scenario(
      'Passing Ignored mutants through the diagnostics leaves them undiagnosed',
      Gherkin.Do.pipe(
        When('an Ignored mutant is handed to the project evaluation')('observed', () =>
          Effect.sync(() => {
            const inventory = analyzeFileWithTsMorph(DISABLED_EQUALITY_TEXT, [])
            const ignored = inventory.mutants.find((m) => m.mutatorName === 'EqualityOperator')
            if (ignored === undefined) throw new Error('expected an Ignored EqualityOperator mutant')

            const composite = inMemoryProjectOf({ '/proj/src/x.ts': DISABLED_EQUALITY_TEXT })
            const result = evaluateWithProjects(
              [packageProjectOf(composite, ['/proj/src/x.ts'])],
              '/proj/src/x.ts',
              DISABLED_EQUALITY_TEXT,
              [ignored],
            ).at(0)
            return {
              status: ignored.status,
              resultDefined: result !== undefined,
              compileError: result?.compileError,
            }
          })),
        Then('the mutant comes back Ignored with no diagnostic')((s, expect) => {
          return expect(s.observed).toStrictEqual({ status: 'Ignored', resultDefined: true, compileError: undefined })
        }),
      ),
    )
  })
