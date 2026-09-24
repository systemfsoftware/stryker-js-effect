import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { effectConcurrencyFixtureFiles, type FixtureFile } from './__fixtures__/effect-concurrency-files.js'
import { importStyles, shapes } from './__fixtures__/effect-concurrency/shapes.js'
import { instrument } from './__fixtures__/instrument.js'

const ATOMIC_UPDATE_SPLIT = 'AtomicUpdateSplit'

const DATA_FIRST_SOURCE = `import { Effect, Ref } from 'effect'

export const bump = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)
`

const DATA_FIRST_REPLACEMENT =
  'Effect.flatMap(Effect.succeed(ref), self => Effect.flatMap(Ref.get(self), s => Effect.flatMap(Ref.make(s), snap => Effect.flatMap(Ref.update(snap, n => n + 1), b => Effect.flatMap(Effect.yieldNow, () => Effect.flatMap(Ref.get(snap), a => Effect.as(Ref.set(self, a), b)))))))'

const DATA_LAST_SOURCE = `import { Effect, pipe, Ref } from 'effect'

export const bumpPiped = (ref: Ref.Ref<number>) => pipe(ref, Ref.update((n: number) => n + 1))
`

const DATA_LAST_REPLACEMENT =
  'self => Effect.flatMap(Ref.get(self), s => Effect.flatMap(Ref.make(s), snap => Effect.flatMap(Ref.update(snap, (n: number) => n + 1), b => Effect.flatMap(Effect.yieldNow, () => Effect.flatMap(Ref.get(snap), a => Effect.as(Ref.set(self, a), b))))))'

const NO_EFFECT_BINDING_SOURCE = `import { Ref } from 'effect'

export const withoutEffect = (ref: Ref.Ref<number>) => Ref.update(ref, (n) => n + 1)
`

const SHADOW_BLOCK_SCOPED_SOURCE = `import { Effect, Ref } from 'effect'

export const hoistedVariableShadow = (ref: Ref.Ref<number>) => {
  var Ref: { readonly update: (r: Ref.Ref<number>, f: (n: number) => number) => Effect.Effect<void> }
  return Ref.update(ref, (n) => n + 1)
}

export const classShadow = (ref: Ref.Ref<number>) => {
  class Ref {}
  return Ref.update(ref, (n) => n + 1)
}

export const namespaceShadow = (ref: Ref.Ref<number>) => {
  namespace Ref {
    export const x = 1
  }
  return Ref.update(ref, (n) => n + 1)
}
`

const SHADOW_PROGRAM_SCOPED_SOURCE = `import { Effect, Ref } from 'effect'
import Ref = require('./shadowed-ref')

enum Ref {
  A,
}

export const enumShadow = (ref: Ref.Ref<number>) => Ref.update(ref, (n) => n + 1)

export const importEqualsShadow = (ref: Ref.Ref<number>) => Ref.update(ref, (n) => n + 1)
`

const TYPE_ALIAS_SOURCE = `import { Effect, Ref } from 'effect'

export const typeAliasDoesNotShadow = (ref: Ref.Ref<number>) => {
  type Ref = number
  return Ref.update(ref, (n) => n + 1)
}
`

const TYPE_ONLY_IMPORT_SOURCE = `import type { Ref } from 'effect'

export const typeOnlyImport = (ref: Ref.Ref<number>) => Ref.update(ref, (n) => n + 1)
`

const BARE_WITHOUT_BINDINGS_SOURCE = `import { update } from 'effect/Ref'

export const bareWithoutBindings = (ref) => update(ref, (n: number) => n + 1)
`

const BARE_WITH_BINDINGS_SOURCE = `import { Effect, Ref } from 'effect'
import { update } from 'effect/Ref'

export const bareWithBindings = (ref: Ref.Ref<number>) => update(ref, (n: number) => n + 1)
`

const ARITY_AND_SPREAD_SOURCE = `import { Effect, Ref } from 'effect'

export const spreadArgument = (ref: Ref.Ref<number>, ...rest: readonly [(n: number) => number]) =>
  Ref.update(ref, ...rest)

export const withoutArguments = () => Ref.update()

export const withThreeArguments = (ref: Ref.Ref<number>) => Ref.update(ref, (n: number) => n + 1, 42)
`

const MOVED_FUNCTION_YIELDS_SOURCE = `import { Effect, Ref } from 'effect'

export const movedFunctionRefusal = Effect.gen(function* () {
  const ref = yield* Ref.make(0)
  const makeIncrement = Effect.succeed((n: number) => n + 1)
  return Ref.update(ref, yield* makeIncrement)
})
`

const MOVED_REF_YIELDS_SOURCE = `import { Effect, Ref } from 'effect'

export const movedRefRefusal = Effect.gen(function* () {
  const ref = yield* Ref.make(0)
  const makeRef = Effect.succeed(ref)
  return Ref.update(yield* makeRef, (n: number) => n + 1)
})
`

const NESTED_COVERED_SOURCE = `import { Effect, Ref } from 'effect'

export const nestedCoveredUpdates = (ref: Ref.Ref<number>) =>
  Ref.update(Ref.update((n: number) => n + 1)(ref), (n: number) => n * 2)
`

const BINDER_CAPTURE_SOURCE = `import { Effect, Ref } from 'effect'

export const capturedNames = (ref: Ref.Ref<number>) => {
  const s = 1
  const self = 2
  const snap = 3
  const a = 4
  const b = 5
  return Ref.update(ref, (n) => n + s + self + snap + a + b)
}
`

const BINDER_CAPTURE_REPLACEMENT =
  'Effect.flatMap(Effect.succeed(ref), self1 => Effect.flatMap(Ref.get(self1), s1 => Effect.flatMap(Ref.make(s1), snap1 => Effect.flatMap(Ref.update(snap1, n => n + s + self + snap + a + b), b1 => Effect.flatMap(Effect.yieldNow, () => Effect.flatMap(Ref.get(snap1), a1 => Effect.as(Ref.set(self1, a1), b1)))))))'

const SUPPRESSED_SOURCE = `import { Effect, Ref } from 'effect'

// Stryker disable next-line AtomicUpdateSplit: race proven elsewhere
export const bump = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)
`

const COVERED_SOURCE = `import { Effect, Ref } from 'effect'

export const bump = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)
`

interface MutantExpectation {
  readonly file: string
  readonly exportName: string
  readonly expectedMutants: number
}

const tableEntries: readonly MutantExpectation[] = [
  ...shapes
    .filter((entry) => entry.mutator === ATOMIC_UPDATE_SPLIT)
    .map((entry) => ({
      file: entry.file,
      exportName: entry.exportName,
      expectedMutants: entry.expectedMutants,
    })),
  ...importStyles.map((style) => ({
    file: style.file,
    exportName: style.exportName,
    expectedMutants: style.expectedMutants,
  })),
]

const uniqueTableEntries = (): readonly MutantExpectation[] => [
  ...new Map(tableEntries.map((entry) => [`${entry.file}::${entry.exportName}`, entry])).values(),
]

const expectedTotalFor = (file: string): number =>
  uniqueTableEntries()
    .filter((entry) => entry.file === file)
    .reduce((total, entry) => total + entry.expectedMutants, 0)

interface ExportLineRange {
  readonly firstLine: number
  readonly lastLine: number
}

const exportLineRange = (content: string, exportName: string): ExportLineRange => {
  const lines = content.split('\n')
  const marker = lines.findIndex((line) => line.startsWith(`export const ${exportName}`))
  const after = lines.slice(marker + 1).findIndex((line) => line.startsWith('export '))
  return { firstLine: marker + 1, lastLine: after === -1 ? lines.length : marker + after + 1 }
}
const instrumentSource = (source: string) =>
  instrument([{ name: '/tmp/atomic-split-probe.ts', content: source, mutate: true }], {
    ignorers: [],
    excludedMutations: [],
    optInMutations: [ATOMIC_UPDATE_SPLIT],
  })

const atomicCount = (result: Instrument.InstrumentResult): number =>
  result.mutants.filter((mutant) => mutant.mutatorName === ATOMIC_UPDATE_SPLIT).length

const atomicMutantsOf = (result: Instrument.InstrumentResult): readonly Mutant.Mutant[] =>
  result.mutants.filter((mutant) => mutant.mutatorName === ATOMIC_UPDATE_SPLIT)

const Feature = makeFeature({ it, layer })

Feature('Exposing lost ref updates by splitting atomic ref updates')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenario }) => {
    const countsScenario = (
      title: `${string} ${string}`,
      givenText: string,
      sources: readonly string[],
      expectedCounts: readonly number[],
    ) =>
      scenario(
        title,
        Gherkin.Do.pipe(
          Given(givenText)('sources', () => Effect.succeed(sources)),
          When('the files are instrumented with only the atomic-update split enabled')(
            'counts',
            ({ sources }: { sources: readonly string[] }) =>
              Effect.forEach(sources, (source) => Effect.map(instrumentSource(source), atomicCount)),
          ),
          Then('the proposed mutants match the expectation exactly')(({ counts }: { counts: readonly number[] }) =>
            Effect.sync(() => expect(counts).toStrictEqual(expectedCounts))
          ),
        ),
      )

    scenario(
      'Each covered shape in the frozen fixtures produces exactly the mutants its table entry promises, and nothing strays',
      Gherkin.Do.pipe(
        Given('every concurrency fixture module has been read from disk')(
          'fixtures',
          () => effectConcurrencyFixtureFiles,
        ),
        When('the files are instrumented with only the atomic-update split enabled')(
          'report',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            instrument(
              fixtures.map((fixture) => ({
                name: `effect-concurrency/${fixture.name}`,
                content: fixture.content,
                mutate: true,
              })),
              { ignorers: [], excludedMutations: [], optInMutations: [ATOMIC_UPDATE_SPLIT] },
            ),
        ),
        Then(
          'every table entry counts its mutants inside its own export, every file totals its table, and no replacement hides behind a cast or a suppression',
        )((
          { fixtures, report }: { fixtures: readonly FixtureFile[]; report: Instrument.InstrumentResult },
        ) =>
          Effect.sync(() => {
            const contentByFile = new Map(
              fixtures.map((fixture) => [`effect-concurrency/${fixture.name}`, fixture.content]),
            )
            const mutantsIn = (fileName: string): readonly Mutant.Mutant[] =>
              report.mutants.filter(
                (mutant) => mutant.mutatorName === ATOMIC_UPDATE_SPLIT && mutant.fileName === fileName,
              )
            for (const entry of uniqueTableEntries()) {
              const content = contentByFile.get(entry.file) ?? ''
              const range = exportLineRange(content, entry.exportName)
              const located = mutantsIn(entry.file).filter(
                (mutant) => {
                  const sourceLine = mutant.location.start.line + 1
                  return range.firstLine <= sourceLine && sourceLine <= range.lastLine
                },
              )
              expect(
                { module: `${entry.file} ${entry.exportName}`, mutants: located.length },
              ).toStrictEqual({ module: `${entry.file} ${entry.exportName}`, mutants: entry.expectedMutants })
            }
            for (const fixture of fixtures) {
              expect({
                module: fixture.name,
                mutants: mutantsIn(`effect-concurrency/${fixture.name}`).length,
              }).toStrictEqual({
                module: fixture.name,
                mutants: expectedTotalFor(`effect-concurrency/${fixture.name}`),
              })
            }
            const forbidden = report.mutants.flatMap((mutant) =>
              ['@ts-ignore', '@ts-expect-error', 'as any', 'as unknown'].flatMap((suppression) =>
                mutant.replacement.includes(suppression) ? [`${mutant.id} contains ${suppression}`] : []
              )
            )
            expect(forbidden).toStrictEqual([])
          })
        ),
      ),
    )

    countsScenario(
      'A file that never binds the Effect module leaves the update alone',
      'a module that updates a ref while only the ref module is bound',
      [NO_EFFECT_BINDING_SOURCE],
      [0],
    )

    countsScenario(
      'A ref shadowed by a hoisted variable, a class, a namespace, an enum, or a require-style import is left alone',
      'five modules whose calls a shadowing declaration hides in each kind of scope',
      [SHADOW_BLOCK_SCOPED_SOURCE, SHADOW_PROGRAM_SCOPED_SOURCE],
      [0, 0],
    )

    countsScenario(
      'A type alias of the same name does not hide the import',
      'a module whose call site is preceded by a type alias sharing the ref name',
      [TYPE_ALIAS_SOURCE],
      [1],
    )

    countsScenario(
      'A type-only import is no binding to build a replacement from',
      'a module whose ref import carries no value across',
      [TYPE_ONLY_IMPORT_SOURCE],
      [0],
    )

    countsScenario(
      'A bare function import needs the module bindings its replacement spells',
      'two modules using the bare update import, one with and one without the module bindings in scope',
      [BARE_WITHOUT_BINDINGS_SOURCE, BARE_WITH_BINDINGS_SOURCE],
      [0, 1],
    )

    countsScenario(
      'Calls the arity table cannot place are left alone',
      'three modules calling with a spread argument, with no arguments, and with one argument too many',
      [ARITY_AND_SPREAD_SOURCE],
      [0],
    )

    countsScenario(
      'An update function that yields while it is moved refuses the split',
      'a generator handing a yielding effect over in the moving function position',
      [MOVED_FUNCTION_YIELDS_SOURCE],
      [0],
    )

    countsScenario(
      'A ref that yields in the ref position refuses the split as well',
      'a generator handing a yielding effect over in the ref position',
      [MOVED_REF_YIELDS_SOURCE],
      [0],
    )

    countsScenario(
      'An update nested inside another update is split on its own, and so is the outer one',
      'a module whose outer update takes an inner update as its ref',
      [NESTED_COVERED_SOURCE],
      [2],
    )

    scenario(
      'The replacement for a direct update reads once, yields, and writes back through a snapshot',
      Gherkin.Do.pipe(
        Given('a module with a direct update of a ref')('source', () => Effect.succeed(DATA_FIRST_SOURCE)),
        When('the file is instrumented with only the atomic-update split enabled')(
          'mutants',
          ({ source }: { source: string }) => Effect.map(instrumentSource(source), atomicMutantsOf),
        ),
        Then('the single mutant replaces the call with the snapshot split, word for word')(
          ({ mutants }: { mutants: readonly Mutant.Mutant[] }) =>
            Effect.sync(() => {
              expect(mutants.length).toBe(1)
              expect(mutants[0]?.replacement).toBe(DATA_FIRST_REPLACEMENT)
            }),
        ),
      ),
    )

    scenario(
      'The replacement for a piped update moves the same split behind a self binder',
      Gherkin.Do.pipe(
        Given('a module piping an update into a ref')('source', () => Effect.succeed(DATA_LAST_SOURCE)),
        When('the file is instrumented with only the atomic-update split enabled')(
          'mutants',
          ({ source }: { source: string }) => Effect.map(instrumentSource(source), atomicMutantsOf),
        ),
        Then('the single mutant replaces the call with the piped snapshot split, word for word')(
          ({ mutants }: { mutants: readonly Mutant.Mutant[] }) =>
            Effect.sync(() => {
              expect(mutants.length).toBe(1)
              expect(mutants[0]?.replacement).toBe(DATA_LAST_REPLACEMENT)
            }),
        ),
      ),
    )

    scenario(
      'Generated names step aside from names the call site already uses',
      Gherkin.Do.pipe(
        Given('a module whose update function closes over every generated name')(
          'source',
          () => Effect.succeed(BINDER_CAPTURE_SOURCE),
        ),
        When('the file is instrumented with only the atomic-update split enabled')(
          'mutants',
          ({ source }: { source: string }) => Effect.map(instrumentSource(source), atomicMutantsOf),
        ),
        Then('the replacement binds suffixed names and leaves the captured names untouched, word for word')(
          ({ mutants }: { mutants: readonly Mutant.Mutant[] }) =>
            Effect.sync(() => {
              expect(mutants.length).toBe(1)
              expect(mutants[0]?.replacement).toBe(BINDER_CAPTURE_REPLACEMENT)
            }),
        ),
      ),
    )

    scenario(
      'A disable comment with a reason is recorded on the ignored mutant',
      Gherkin.Do.pipe(
        Given('a module whose update call sits under a disable comment giving a reason')(
          'source',
          () => Effect.succeed(SUPPRESSED_SOURCE),
        ),
        When('the file is instrumented with only the atomic-update split enabled')(
          'report',
          ({ source }: { source: string }) => instrumentSource(source),
        ),
        Then('the single mutant is reported as ignored, carrying the comment reason')(
          ({ report }: { report: Instrument.InstrumentResult }) =>
            Effect.sync(() => {
              const mutants = atomicMutantsOf(report)
              expect(mutants.length).toBe(1)
              expect(mutants[0]?.status).toBe('Ignored')
              expect(mutants[0]?.statusReason).toBe('race proven elsewhere')
            }),
        ),
      ),
    )

    scenario(
      'A run that excludes the split still reports its mutants, ignored',
      Gherkin.Do.pipe(
        Given('a module with a plain update call')('source', () => Effect.succeed(COVERED_SOURCE)),
        When('the file is instrumented with the split enabled but excluded')(
          'report',
          ({ source }: { source: string }) =>
            instrument([{ name: '/tmp/atomic-split-probe.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [ATOMIC_UPDATE_SPLIT],
              optInMutations: [ATOMIC_UPDATE_SPLIT],
            }),
        ),
        Then('the single mutant is reported as ignored for the exclusion')(
          ({ report }: { report: Instrument.InstrumentResult }) =>
            Effect.sync(() => {
              const mutants = atomicMutantsOf(report)
              expect(mutants.length).toBe(1)
              expect(mutants[0]?.status).toBe('Ignored')
              expect(mutants[0]?.statusReason).toBe(`Ignored because of excluded mutation "${ATOMIC_UPDATE_SPLIT}"`)
            }),
        ),
      ),
    )
  })
