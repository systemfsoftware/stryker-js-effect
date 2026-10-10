import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument, lineStartsOf, offsetAt } from '@systemfsoftware/stryker-js-instrumenter'
import { afterAll } from '@systemfsoftware/vitest'
import { Effect, FileSystem, Layer, Option } from 'effect'
import type { PlatformError } from 'effect'

import { PlacementHarnessError } from './__fixtures__/conditional-test-placement.schema.js'
import { stockOptions } from './__fixtures__/instrument.js'

const SCRATCH_URL = new URL('../.scratch/placement-behaviour/', import.meta.url)
const MUTANT_ROOT = new URL('mutant/', SCRATCH_URL)
const REFERENCE_ROOT = new URL('reference/', SCRATCH_URL)
const LABEL = 'label'
const COUNTS: readonly (readonly number[])[] = [[1], [-1], [0]]

const TERNARY_LABEL_SOURCE = `export const label = (count: number): string => (count > 0 ? 'yes' : 'no')
`

const TERNARY_VALUE_SOURCE = `export const label = (count: number): number => (count > 0 ? count * 2 : 0)
`

const NESTED_TERNARY_SOURCE =
  `export const label = (count: number): string => count > 0 ? count > 1 ? 'big' : 'small' : 'none'
`

const GUARD_SOURCE = `export const label = (count: number): string => {
  if (count > 0) {
    return 'yes'
  }
  return 'no'
}
`

const AND_SOURCE = `export const label = (count: number): string | boolean => count > 0 && 'big'
`

const OR_SOURCE = `export const label = (count: number): string | boolean => count > 0 || 'fallback'
`

const DISABLED_CONDITIONAL = '// Stryker disable ConditionalExpression: the branch choice is covered elsewhere'
const DISABLED_EQUALITY = '// Stryker disable EqualityOperator: the comparison is covered elsewhere'

const DISABLED_GUARD_SOURCE = `export const label = (count: number): string => {
  ${DISABLED_CONDITIONAL}
  if (count > 0) {
    return 'yes'
  }
  return 'no'
}
`

const DISABLED_TERNARY_SOURCE = `export const label = (count: number): string => {
  ${DISABLED_CONDITIONAL}
  return count > 0 ? 'yes' : 'no'
}
`

const DISABLED_AND_SOURCE = `export const label = (count: number, threshold: number): boolean => {
  ${DISABLED_CONDITIONAL}
  return count > 0 && threshold > 1
}
`

const DISABLED_EQUALITY_SOURCE = `export const label = (count: number): string => {
  ${DISABLED_EQUALITY}
  if (count > 0) {
    return 'yes'
  }
  return 'no'
}
`

interface Shape {
  readonly id: string
  readonly subject: string
  readonly source: string
}

/** The directive silences a subset of a node's mutants, so the rest must not shift into the silenced slots. */
const DISABLED_SHAPES: readonly Shape[] = [
  {
    id: 'disabled-guard',
    subject: 'a guard whose conditional mutants are disabled',
    source: DISABLED_GUARD_SOURCE,
  },
  {
    id: 'disabled-ternary',
    subject: 'a ternary whose conditional mutants are disabled',
    source: DISABLED_TERNARY_SOURCE,
  },
  {
    id: 'disabled-and',
    subject: 'a conjunction whose conditional mutants are disabled',
    source: DISABLED_AND_SOURCE,
  },
  {
    id: 'disabled-equality',
    subject: 'a guard whose equality mutants are disabled',
    source: DISABLED_EQUALITY_SOURCE,
  },
]

const SHAPES: readonly Shape[] = [
  { id: 'ternary-label', subject: 'a ternary that labels a counter', source: TERNARY_LABEL_SOURCE },
  { id: 'ternary-value', subject: 'a ternary that doubles a counter', source: TERNARY_VALUE_SOURCE },
  { id: 'nested-ternary', subject: 'a nested ternary that grades a counter', source: NESTED_TERNARY_SOURCE },
  { id: 'guard', subject: 'a guard that labels a counter', source: GUARD_SOURCE },
  { id: 'and-label', subject: 'a label that requires the counter to be above zero', source: AND_SOURCE },
  { id: 'or-label', subject: 'a label that falls back when the counter is not above zero', source: OR_SOURCE },
]

const ALL_SHAPES: readonly Shape[] = [...SHAPES, ...DISABLED_SHAPES]

type CollectedMutant = Instrument.InstrumentResult['mutants'][number]
type Outcome = string | number | boolean | undefined

interface ShapeModule {
  readonly label: (...args: readonly number[]) => Outcome
}

interface Observation {
  readonly result: string
}

interface Row {
  readonly mutant: string
  readonly mutator: string
  readonly activated: readonly Observation[]
  readonly rewritten: readonly Observation[]
}

interface EmittedArm {
  readonly mutant: string
  readonly mutator: string
  readonly replacement: string
  readonly bound: string
}

interface ShapeReport {
  readonly subject: string
  readonly ignoredCount: number
  readonly rows: readonly Row[]
  readonly arms: readonly EmittedArm[]
}

const filePathOf = (url: URL): string => url.pathname

const isShapeModule = (value: unknown): value is ShapeModule =>
  typeof value === 'object' && value !== null && 'label' in value && typeof value.label === 'function'

const loadModule = (url: URL): Effect.Effect<ShapeModule, PlacementHarnessError> =>
  Effect.filterOrFail(
    Effect.tryPromise({
      try: () => import(url.href),
      catch: () => PlacementHarnessError.make({ message: `importing ${url.href} failed`, cause: undefined }),
    }),
    isShapeModule,
    () => PlacementHarnessError.make({ message: `${url.href} exports no callable ${LABEL}`, cause: undefined }),
  )

const spliceMutant = (shape: Shape, mutant: CollectedMutant): string => {
  const lineStarts = lineStartsOf(shape.source)
  const start = Option.getOrThrow(offsetAt(lineStarts, mutant.location.start))
  const end = Option.getOrThrow(offsetAt(lineStarts, mutant.location.end))
  return `${shape.source.slice(0, start)}${mutant.replacement}${shape.source.slice(end)}`
}

const callLabel = (module: ShapeModule, args: readonly number[]): Effect.Effect<Outcome, PlacementHarnessError> =>
  Effect.try({
    try: () => module.label(...args),
    catch: () =>
      PlacementHarnessError.make({ message: `calling ${LABEL}(${args.join(', ')}) failed`, cause: undefined }),
  })

const observe = (module: ShapeModule): Effect.Effect<readonly Observation[], PlacementHarnessError> =>
  Effect.forEach(
    COUNTS,
    (args) =>
      Effect.map(callLabel(module, args), (outcome): Observation => ({ result: JSON.stringify(outcome ?? null) })),
    { concurrency: 1 },
  )

const isNamespaceRecord = (value: unknown): value is Record<string, string | undefined> =>
  typeof value === 'object' && value !== null

const hostNamespace = (): object =>
  Option.getOrElse(
    Option.liftPredicate(isNamespaceRecord)(Reflect.get(globalThis, Instrument.InstrumenterContext.NAMESPACE)),
    () => {
      const created: Record<string, string | undefined> = {}
      Reflect.set(globalThis, Instrument.InstrumenterContext.NAMESPACE, created)
      return created
    },
  )

const activate = (id: string | undefined): Effect.Effect<void> =>
  Effect.sync(() => Reflect.set(hostNamespace(), Instrument.InstrumenterContext.ACTIVE_MUTANT, id))

const observeWithMutant = (url: URL, id: string): Effect.Effect<readonly Observation[], PlacementHarnessError> =>
  Effect.ensuring(
    Effect.gen(function*() {
      yield* activate(id)
      const module = yield* loadModule(url)
      return yield* observe(module)
    }),
    activate(undefined),
  )

const prepareScratch: Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> = Effect.flatMap(
  FileSystem.FileSystem,
  (fs) =>
    Effect.andThen(
      fs.remove(filePathOf(SCRATCH_URL), { recursive: true, force: true }),
      Effect.andThen(
        Effect.andThen(
          fs.makeDirectory(filePathOf(MUTANT_ROOT), { recursive: true }),
          fs.makeDirectory(filePathOf(REFERENCE_ROOT), { recursive: true }),
        ),
        Effect.void,
      ),
    ),
)

const clearScratch: Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> = Effect.flatMap(
  FileSystem.FileSystem,
  (fs) => fs.remove(filePathOf(SCRATCH_URL), { recursive: true, force: true }),
)

const rowOf = (shape: Shape, mutant: CollectedMutant, content: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const name = `${shape.id}-${mutant.id}.ts`
    const mutantUrl = new URL(name, MUTANT_ROOT)
    const referenceUrl = new URL(name, REFERENCE_ROOT)
    const reference = mutant.status === 'Ignored' && mutant.redundancy === undefined
      ? shape.source
      : spliceMutant(shape, mutant)
    yield* fs.writeFileString(filePathOf(mutantUrl), content)
    yield* fs.writeFileString(filePathOf(referenceUrl), reference)
    const rewritten = yield* loadModule(referenceUrl)
    return {
      mutant: mutant.id,
      mutator: mutant.mutatorName,
      activated: yield* observeWithMutant(mutantUrl, mutant.id),
      rewritten: yield* observe(rewritten),
    }
  })

const ARM_TEST = (mutantId: string): string => `("${mutantId}") ? `

const armsOf = (mutants: readonly CollectedMutant[], content: string): readonly EmittedArm[] =>
  mutants.flatMap((mutant) => {
    const test = ARM_TEST(mutant.id)
    const at = content.indexOf(test)
    return at === -1 ? [] : [{
      mutant: mutant.id,
      mutator: mutant.mutatorName,
      replacement: mutant.replacement,
      bound: content.slice(at + test.length, at + test.length + mutant.replacement.length),
    }]
  })

const buildReport = (shape: Shape) =>
  Effect.gen(function*() {
    yield* prepareScratch
    const result = yield* Instrument.instrument(
      ALL_SHAPES.map((candidate) => ({ name: `${candidate.id}.ts`, content: candidate.source, mutate: true })),
      stockOptions({ ignorers: [], excludedMutations: [] }),
    )
    const instrumented = result.files.find((file) => file.name === `${shape.id}.ts`)
    if (instrumented === undefined) {
      return yield* PlacementHarnessError.make({
        message: `the instrumenter returned no file for ${shape.id}`,
        cause: undefined,
      })
    }
    const mutants = result.mutants.filter((mutant) => mutant.fileName === `${shape.id}.ts`)
    return {
      subject: shape.subject,
      ignoredCount: mutants.filter((mutant) => mutant.status === 'Ignored' && mutant.redundancy === undefined).length,
      arms: armsOf(mutants, instrumented.content),
      rows: yield* Effect.forEach(mutants, (mutant) => rowOf(shape, mutant, instrumented.content), { concurrency: 1 }),
    }
  })

const disagrees = (row: Row): boolean =>
  row.activated.length !== row.rewritten.length ||
  row.activated.some((observation, index) => observation.result !== row.rewritten.at(index)?.result)

const disagreementsIn = (report: ShapeReport): readonly Row[] => report.rows.filter(disagrees)

const misplacedArmsIn = (report: ShapeReport): readonly EmittedArm[] =>
  report.arms.filter((arm) => arm.bound !== arm.replacement)

const carriesDirective = (shape: Shape): boolean => shape.source.includes('// Stryker disable')

const anomaliesIn = (shape: Shape, report: ShapeReport): readonly string[] => [
  ...(carriesDirective(shape) && report.ignoredCount === 0
    ? [`the directive in ${report.subject} silenced no mutant, so the shape proves nothing`]
    : []),
  ...disagreementsIn(report).map((row) =>
    `mutant ${row.mutant} (${row.mutator}) activated as ${
      JSON.stringify(row.activated)
    } but rewriting that mutant gives ${JSON.stringify(row.rewritten)}`
  ),
  ...misplacedArmsIn(report).map((arm) =>
    `the emitted arm for mutant ${arm.mutant} (${arm.mutator}) carries ${JSON.stringify(arm.bound)} instead of ${
      JSON.stringify(arm.replacement)
    }`
  ),
]

const liveReport = (shape: Shape) => Effect.provide(buildReport(shape), NodeFileSystem.layer)

afterAll(() => Effect.runPromise(Effect.provide(clearScratch, NodeFileSystem.layer)))

const Feature = makeFeature({ it })

Feature('Running a single mutation without disturbing the rest of the program')
  .live('the harness writes real instrumented modules to disk and runs them at run time')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    for (const shape of ALL_SHAPES) {
      scenario(
        `Each mutant of ${shape.subject} keeps its own replacement`,
        Gherkin.Do.pipe(
          Given(`the mutants proposed for ${shape.subject}`)('report', () => liveReport(shape)),
          When('each mutant is activated and every emitted arm is read back')(
            'anomalies',
            ({ report }: { report: ShapeReport }) => Effect.sync(() => anomaliesIn(shape, report)),
          ),
          Then('each mutant behaves as its own replacement, or as the untouched program when a directive ignores it')((
            { anomalies }: { anomalies: readonly string[] },
            expect,
          ) => expect(anomalies).toStrictEqual([])),
        ),
      )
    }
  })
