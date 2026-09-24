import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { InstrumentResult, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { effectConcurrencyFixtureFiles, type FixtureFile } from './__fixtures__/effect-concurrency-files.js'
import { shapes } from './__fixtures__/effect-concurrency/shapes.js'
import { instrument } from './__fixtures__/instrument.js'

const FINALIZER_ESCAPE = 'FinalizerEscape'

const ENSURING_DATA_FIRST_SOURCE = `import { Effect, Ref } from 'effect'

export const ensuringDataFirst = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.ensuring(effect, Ref.set(closed, true))
`

const ENSURING_DATA_FIRST_REPLACEMENT =
  'Effect.onExitIf(effect, exit => exit._tag === "Success" || !exit.cause.reasons.some(reason => reason._tag === "Interrupt"), () => Ref.set(closed, true))'

const ON_ERROR_DATA_FIRST_SOURCE = `import { Effect, Ref } from 'effect'

export const onErrorDataFirst = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.onError(effect, () => Ref.set(closed, true))
`

const ON_ERROR_DATA_FIRST_REPLACEMENT =
  'Effect.onErrorIf(effect, cause => !cause.reasons.some(reason => reason._tag === "Interrupt"), () => Ref.set(closed, true))'

const ACQUIRE_RELEASE_SOURCE = `import { Effect, Ref } from 'effect'

export const acquireReleaseTwoArg = (acquire: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.acquireRelease(acquire, () => Ref.getAndSet(closed, true))
`

const ACQUIRE_RELEASE_REPLACEMENT =
  'Effect.flatMap(Effect.interruptible(acquire), a => Effect.acquireRelease(Effect.succeed(a), () => Ref.getAndSet(closed, true)))'

const ACQUIRE_USE_RELEASE_SOURCE = `import { Effect, Ref } from 'effect'

export const acquireUseReleaseBrackets = (
  acquire: Effect.Effect<number>,
  use: (a: number) => Effect.Effect<number>,
  closed: Ref.Ref<boolean>,
) => Effect.acquireUseRelease(acquire, use, () => Ref.set(closed, true))
`

const ACQUIRE_USE_RELEASE_REPLACEMENT =
  'Effect.acquireUseRelease(acquire, use, (a, exit) => exit._tag === "Success" || !exit.cause.reasons.some(reason => reason._tag === "Interrupt") ? (() => Ref.set(closed, true))() : Effect.void)'

const HANDLER_BUILT_BY_CALL_SOURCE = `import { Effect, Ref } from 'effect'

const makeHandler = (closed: Ref.Ref<boolean>) => Ref.set(closed, true)

export const onInterruptHandlerCall = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.onInterrupt(effect, makeHandler(closed))
`

const YIELDING_CLEANUP_SOURCE = `import { Effect } from 'effect'

export const ensuringYieldingCleanup = Effect.gen(function* () {
  const makeCleanup = Effect.succeed(Effect.void)
  return Effect.ensuring(Effect.succeed(1), yield* makeCleanup)
})
`

const LOCAL_HELPER_SOURCE = `import { Effect, Ref } from 'effect'

const ensuring = (effect: Effect.Effect<number>, cleanup: Effect.Effect<void>) => effect

export const localEnsuringRefusal = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  ensuring(effect, Ref.set(closed, true))
`

const YIELDING_RELEASE_SOURCE = `import { Effect, Ref } from 'effect'

export const useReleaseYieldingRelease = Effect.gen(function* () {
  const closed = yield* Ref.make(false)
  const makeRelease = Effect.succeed(() => Ref.set(closed, true))
  return Effect.acquireUseRelease(Effect.succeed(1), (n) => Effect.succeed(n), yield* makeRelease)
})
`

const IDENTIFIER_RELEASE_SOURCE = `import { Effect, Exit } from 'effect'

const release = (acquired: number, exit: Exit.Exit<number, never>) => Effect.void

export const useReleaseIdentifierRelease = (acquire: Effect.Effect<number>, use: (a: number) => Effect.Effect<number>) =>
  Effect.acquireUseRelease(acquire, use, release)
`

const SUPPRESSED_SOURCE = `import { Effect, Ref } from 'effect'

// Stryker disable next-line FinalizerEscape: cleanup proven by concurrency tests
export const ensuringDataFirst = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) => Effect.ensuring(effect, Ref.set(closed, true))
`

const LEADER_LOCK_SOURCE = `import { Deferred, Effect, Exit, Ref, Scope } from 'effect'

export const leaderLockScopeClose = (
  tryAcquire: Effect.Effect<boolean>,
  guarded: Effect.Effect<number>,
  closed: Ref.Ref<boolean>,
) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const acquired = yield* restore(tryAcquire).pipe(
        Scope.provide(scope),
        Effect.onError(() => Ref.set(closed, true)),
      )
      const result = yield* restore(guarded).pipe(
        Effect.ensuring(Effect.andThen(Scope.close(scope, Exit.void), Ref.set(closed, true))),
      )
      return { acquired, result }
    })
  )
`

const LITERAL_CASES = [
  {
    cleanup: 'ensuring cleanup',
    source: ENSURING_DATA_FIRST_SOURCE,
    replacement: ENSURING_DATA_FIRST_REPLACEMENT,
  },
  {
    cleanup: 'error handler',
    source: ON_ERROR_DATA_FIRST_SOURCE,
    replacement: ON_ERROR_DATA_FIRST_REPLACEMENT,
  },
  {
    cleanup: 'release bracket',
    source: ACQUIRE_RELEASE_SOURCE,
    replacement: ACQUIRE_RELEASE_REPLACEMENT,
  },
  {
    cleanup: 'use-and-release bracket',
    source: ACQUIRE_USE_RELEASE_SOURCE,
    replacement: ACQUIRE_USE_RELEASE_REPLACEMENT,
  },
] as const

const REFUSAL_CASES = [
  {
    situation: 'a cleanup handler the module would have to build with a call',
    source: HANDLER_BUILT_BY_CALL_SOURCE,
  },
  { situation: 'a cleanup that yields while it is moved', source: YIELDING_CLEANUP_SOURCE },
  { situation: 'a local helper sharing the covered name', source: LOCAL_HELPER_SOURCE },
  { situation: 'a release that yields while it is moved', source: YIELDING_RELEASE_SOURCE },
  { situation: 'a release the module passes in as a binding', source: IDENTIFIER_RELEASE_SOURCE },
] as const

interface MutantExpectation {
  readonly file: string
  readonly exportName: string
  readonly expectedMutants: number
}

const tableEntries: readonly MutantExpectation[] = shapes
  .filter((entry) => entry.mutator === FINALIZER_ESCAPE)
  .map((entry) => ({ file: entry.file, exportName: entry.exportName, expectedMutants: entry.expectedMutants }))

const coveredPairs: readonly { readonly file: string; readonly exportName: string }[] = tableEntries.filter(
  (entry, index) =>
    tableEntries.findIndex(
      (candidate) => candidate.file === entry.file && candidate.exportName === entry.exportName,
    ) === index,
)

const expectedInRange = (file: string, exportName: string): number =>
  tableEntries
    .filter((entry) => entry.file === file && entry.exportName === exportName)
    .reduce((total, entry) => total + entry.expectedMutants, 0)

const expectedTotalFor = (file: string): number =>
  tableEntries.filter((entry) => entry.file === file).reduce((total, entry) => total + entry.expectedMutants, 0)

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
  instrument([{ name: '/tmp/finalizer-escape-probe.ts', content: source, mutate: true }], {
    ignorers: [],
    excludedMutations: [],
    optInMutations: [FINALIZER_ESCAPE],
  })

const finalizerCount = (result: InstrumentResult): number =>
  result.mutants.filter((mutant) => mutant.mutatorName === FINALIZER_ESCAPE).length

const finalizerMutantsOf = (result: InstrumentResult): readonly Mutant[] =>
  result.mutants.filter((mutant) => mutant.mutatorName === FINALIZER_ESCAPE)

const Feature = makeFeature({ it, layer })

Feature('Exposing missing cleanup after interruptions by letting finalizers escape')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'Every covered cleanup call in the frozen fixture modules produces exactly the mutants its table entry promises, and nothing strays',
      Gherkin.Do.pipe(
        Given('every concurrency fixture module has been read from disk')(
          'fixtures',
          () => effectConcurrencyFixtureFiles,
        ),
        When('the files are instrumented with only the finalizer escape enabled')(
          'report',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            instrument(
              fixtures.map((fixture) => ({
                name: `effect-concurrency/${fixture.name}`,
                content: fixture.content,
                mutate: true,
              })),
              { ignorers: [], excludedMutations: [], optInMutations: [FINALIZER_ESCAPE] },
            ),
        ),
        Then(
          'every table entry counts its mutants inside its own export, every file totals its table, and no replacement hides behind a cast or a suppression',
        )((
          { fixtures, report }: { fixtures: readonly FixtureFile[]; report: InstrumentResult },
        ) =>
          Effect.sync(() => {
            const contentByFile = new Map(
              fixtures.map((fixture) => [`effect-concurrency/${fixture.name}`, fixture.content]),
            )
            const mutantsIn = (fileName: string): readonly Mutant[] =>
              report.mutants.filter(
                (mutant) => mutant.mutatorName === FINALIZER_ESCAPE && mutant.fileName === fileName,
              )
            for (const pair of coveredPairs) {
              const content = contentByFile.get(pair.file) ?? ''
              const range = exportLineRange(content, pair.exportName)
              const located = mutantsIn(pair.file).filter((mutant) => {
                const sourceLine = mutant.location.start.line + 1
                return range.firstLine <= sourceLine && sourceLine <= range.lastLine
              })
              expect(
                { module: `${pair.file} ${pair.exportName}`, mutants: located.length },
              ).toStrictEqual({
                module: `${pair.file} ${pair.exportName}`,
                mutants: expectedInRange(pair.file, pair.exportName),
              })
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

    scenarioOutline(
      'The <cleanup> replacement reads word for word as promised',
      LITERAL_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given('a module with one covered cleanup call')('source', () => Effect.succeed(row.source)),
          When('the module is instrumented with only the finalizer escape enabled')(
            'mutants',
            ({ source }: { source: string }) => Effect.map(instrumentSource(source), finalizerMutantsOf),
          ),
          Then('the one proposed mutant spells the promised replacement word for word')(
            ({ mutants }: { mutants: readonly Mutant[] }) =>
              Effect.sync(() => {
                expect(mutants.length).toBe(1)
                expect(mutants[0]?.replacement).toBe(row.replacement)
              }),
          ),
        ),
    )

    scenarioOutline(
      'A <situation> is left alone',
      REFUSAL_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given(row.situation)('source', () => Effect.succeed(row.source)),
          When('the module is instrumented with only the finalizer escape enabled')(
            'count',
            ({ source }: { source: string }) => Effect.map(instrumentSource(source), finalizerCount),
          ),
          Then('no mutant is proposed')((
            { count }: { count: number },
          ) => Effect.sync(() => expect(count).toBe(0))),
        ),
    )

    scenario(
      'The scope-close evidence module keeps exactly its error-handler fault and its final-cleanup fault',
      Gherkin.Do.pipe(
        Given('the evidence module from the issue, closing a scope behind a handler and a cleanup')(
          'source',
          () => Effect.succeed(LEADER_LOCK_SOURCE),
        ),
        When('the module is instrumented with only the finalizer escape enabled')(
          'mutants',
          ({ source }: { source: string }) => Effect.map(instrumentSource(source), finalizerMutantsOf),
        ),
        Then('exactly one proposed replacement guards the error handler, and exactly one guards the final cleanup')(
          ({ mutants }: { mutants: readonly Mutant[] }) =>
            Effect.sync(() => {
              expect(mutants.length).toBe(2)
              expect(mutants.filter((mutant) => mutant.replacement.includes('.onErrorIf(')).length).toBe(1)
              expect(mutants.filter((mutant) => mutant.replacement.includes('.onExitIf(')).length).toBe(1)
            }),
        ),
      ),
    )

    scenario(
      'A disable comment with a reason is recorded on the ignored mutant',
      Gherkin.Do.pipe(
        Given('a module whose cleanup call sits under a disable comment giving a reason')(
          'source',
          () => Effect.succeed(SUPPRESSED_SOURCE),
        ),
        When('the module is instrumented with only the finalizer escape enabled')(
          'mutants',
          ({ source }: { source: string }) => Effect.map(instrumentSource(source), finalizerMutantsOf),
        ),
        Then('the single mutant is reported as ignored, carrying the comment reason')(
          ({ mutants }: { mutants: readonly Mutant[] }) =>
            Effect.sync(() => {
              expect(mutants.length).toBe(1)
              expect(mutants[0]?.status).toBe('Ignored')
              expect(mutants[0]?.statusReason).toBe('cleanup proven by concurrency tests')
            }),
        ),
      ),
    )
  })
