import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { InstrumentResult, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'
import { expect } from 'vitest'

import {
  effectConcurrencyFixtureContent,
  effectConcurrencyFixtureFiles,
  type FixtureFile,
} from './__fixtures__/effect-concurrency-files.js'
import { shapes } from './__fixtures__/effect-concurrency/shapes.js'
import { instrument } from './__fixtures__/instrument.js'

const SYNCHRONIZATION_REMOVAL = 'SynchronizationRemoval'

const GUARDED_SOURCE = `import { Effect, Semaphore } from 'effect'

export const guarded = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  Semaphore.withPermits(sem, 1, effect)
`

const GUARDED_REPLACEMENT = 'effect'

const FROZEN_PIPE_SOURCE = `import { Effect, pipe } from 'effect'

export const frozen = (effect: Effect.Effect<number>) => pipe(effect, Effect.uninterruptible)
`

const FROZEN_PIPE_REPLACEMENT = 'self => self'

const MASKED_SOURCE = `import { Effect } from 'effect'

export const masked = (effect: Effect.Effect<number>) => Effect.uninterruptibleMask((restore) => restore(effect))
`

const MASKED_REPLACEMENT = 'Effect.suspend(() => (restore => restore(effect))(Effect.interruptible))'

const METHOD_FORM_SOURCE = `import { Effect, Semaphore } from 'effect'

export const methodForm = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  sem.withPermits(1)(effect)
`

const FOREIGN_SEMAPHORE_SOURCE = `import { Effect } from 'effect'
import { Semaphore } from './local-semaphore.js'

export const foreignSemaphore = (sem: Semaphore, effect: Effect.Effect<number>) =>
  Semaphore.withPermits(sem, 1, effect)
`

const BUSY_SEMAPHORE_SOURCE = `import { Effect, Semaphore } from 'effect'

export const makeSem = () => Semaphore.make(1)

export const busySemaphore = (effect: Effect.Effect<number>) => Semaphore.withPermits(makeSem(), 1, effect)
`

const SUPPRESSED_SOURCE = `import { Effect, Semaphore } from 'effect'

export const guarded = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  // Stryker disable next-line SynchronizationRemoval: the race is proven by the lock suite
  Semaphore.withPermits(sem, 1, effect)
`

const NAMED_STYLE_SOURCE = GUARDED_SOURCE

const ALIASED_STYLE_SOURCE = `import { Effect, Semaphore as S } from 'effect'

export const aliasedGuard = (sem: S.Semaphore, effect: Effect.Effect<number>) =>
  S.withPermits(sem, 1, effect)
`

const EFFECT_NAMESPACE_STYLE_SOURCE = `import * as E from 'effect'

export const effectNamespaceGuard = (
  sem: E.Semaphore.Semaphore,
  effect: E.Effect.Effect<number>,
) => E.Semaphore.withPermits(sem, 1, effect)
`

const MODULE_NAMESPACE_STYLE_SOURCE = `import { Effect } from 'effect'
import * as Semaphore from 'effect/Semaphore'

export const moduleNamespaceGuard = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  Semaphore.withPermits(sem, 1, effect)
`

interface MutantExpectation {
  readonly file: string
  readonly exportName: string
  readonly expectedMutants: number
}

const tableEntries: readonly MutantExpectation[] = shapes
  .filter((entry) => entry.mutator === SYNCHRONIZATION_REMOVAL)
  .map((entry) => ({
    file: entry.file,
    exportName: entry.exportName,
    expectedMutants: entry.expectedMutants,
  }))

const expectedTotalFor = (file: string): number =>
  tableEntries
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
  instrument([{ name: '/tmp/sync-removal-probe.ts', content: source, mutate: true }], {
    ignorers: [],
    excludedMutations: [],
    optInMutations: [SYNCHRONIZATION_REMOVAL],
  })

const removalCount = (result: InstrumentResult): number =>
  result.mutants.filter((mutant) => mutant.mutatorName === SYNCHRONIZATION_REMOVAL).length

const removalMutantsOf = (result: InstrumentResult): readonly Mutant[] =>
  result.mutants.filter((mutant) => mutant.mutatorName === SYNCHRONIZATION_REMOVAL)

const Feature = makeFeature({ it, layer })

Feature('Exposing unguarded concurrency by removing synchronization from effects')
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
          When('the files are instrumented with only synchronization removal enabled')(
            'counts',
            ({ sources }: { sources: readonly string[] }) =>
              Effect.forEach(sources, (source) => Effect.map(instrumentSource(source), removalCount)),
          ),
          Then('the proposed mutants match the expectation exactly')(({ counts }: { counts: readonly number[] }) =>
            Effect.sync(() => expect(counts).toStrictEqual(expectedCounts))
          ),
        ),
      )

    scenario(
      'Every guarded shape in the frozen fixtures is offered exactly once, and nothing strays outside its promise',
      Gherkin.Do.pipe(
        Given('every concurrency fixture module has been read from disk')(
          'fixtures',
          () => effectConcurrencyFixtureFiles,
        ),
        When('the files are instrumented with only synchronization removal enabled')(
          'report',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            instrument(
              fixtures.map((fixture) => ({
                name: `effect-concurrency/${fixture.name}`,
                content: fixture.content,
                mutate: true,
              })),
              { ignorers: [], excludedMutations: [], optInMutations: [SYNCHRONIZATION_REMOVAL] },
            ),
        ),
        Then(
          'every promised guard sits inside its own exported block, every file totals its promises, and no replacement hides behind a cast or a suppression',
        )((
          { fixtures, report }: { fixtures: readonly FixtureFile[]; report: InstrumentResult },
        ) =>
          Effect.sync(() => {
            const contentByFile = new Map(
              fixtures.map((fixture) => [`effect-concurrency/${fixture.name}`, fixture.content]),
            )
            const mutantsIn = (fileName: string): readonly Mutant[] =>
              report.mutants.filter(
                (mutant) => mutant.mutatorName === SYNCHRONIZATION_REMOVAL && mutant.fileName === fileName,
              )
            for (const entry of tableEntries) {
              const content = contentByFile.get(entry.file) ?? ''
              const range = exportLineRange(content, entry.exportName)
              const located = mutantsIn(entry.file).filter((mutant) => {
                const sourceLine = mutant.location.start.line + 1
                return range.firstLine <= sourceLine && sourceLine <= range.lastLine
              })
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
      'A guard is offered whatever way the semaphore reached the file',
      'four modules guarding an effect through each import style',
      [NAMED_STYLE_SOURCE, ALIASED_STYLE_SOURCE, EFFECT_NAMESPACE_STYLE_SOURCE, MODULE_NAMESPACE_STYLE_SOURCE],
      [1, 1, 1, 1],
    )

    countsScenario(
      'A guard the file did not truly borrow is left in place',
      'three modules whose guard is a method on the value, a semaphore from elsewhere, or built on the spot',
      [METHOD_FORM_SOURCE, FOREIGN_SEMAPHORE_SOURCE, BUSY_SEMAPHORE_SOURCE],
      [0, 0, 0],
    )

    scenario(
      'Dropping the guard leaves only the guarded work behind',
      Gherkin.Do.pipe(
        Given('a module guarding an effect with a counting semaphore')('source', () => Effect.succeed(GUARDED_SOURCE)),
        When('the file is instrumented with only synchronization removal enabled')(
          'mutants',
          ({ source }: { source: string }) => Effect.map(instrumentSource(source), removalMutantsOf),
        ),
        Then('the single mutant is the guarded effect, word for word')(
          ({ mutants }: { mutants: readonly Mutant[] }) =>
            Effect.sync(() => {
              expect(mutants.length).toBe(1)
              expect(mutants[0]?.replacement).toBe(GUARDED_REPLACEMENT)
            }),
        ),
      ),
    )

    scenario(
      'A frozen unguarded reference becomes the plainest pass-through',
      Gherkin.Do.pipe(
        Given('a module freezing an effect by handing the reference itself to the pipe')(
          'source',
          () => Effect.succeed(FROZEN_PIPE_SOURCE),
        ),
        When('the file is instrumented with only synchronization removal enabled')(
          'mutants',
          ({ source }: { source: string }) => Effect.map(instrumentSource(source), removalMutantsOf),
        ),
        Then('the single mutant hands each piped effect straight back, word for word')(
          ({ mutants }: { mutants: readonly Mutant[] }) =>
            Effect.sync(() => {
              expect(mutants.length).toBe(1)
              expect(mutants[0]?.replacement).toBe(FROZEN_PIPE_REPLACEMENT)
            }),
        ),
      ),
    )

    scenario(
      'Lifting the mask still runs the wrapped work once, unmasked',
      Gherkin.Do.pipe(
        Given('a module masking an effect behind a restore-handing callback')(
          'source',
          () => Effect.succeed(MASKED_SOURCE),
        ),
        When('the file is instrumented with only synchronization removal enabled')(
          'mutants',
          ({ source }: { source: string }) => Effect.map(instrumentSource(source), removalMutantsOf),
        ),
        Then('the single mutant defers the callback and hands it an always-restoring region, word for word')(
          ({ mutants }: { mutants: readonly Mutant[] }) =>
            Effect.sync(() => {
              expect(mutants.length).toBe(1)
              expect(mutants[0]?.replacement).toBe(MASKED_REPLACEMENT)
            }),
        ),
      ),
    )

    scenario(
      'The leader lock from the issue report loses exactly its mask',
      Gherkin.Do.pipe(
        Given('the leader lock module from the issue evidence, read from disk')(
          'content',
          () => effectConcurrencyFixtureContent('finalizer-escape.ts'),
        ),
        When('the file is instrumented with only synchronization removal enabled')(
          'mutants',
          ({ content }: { content: string }) =>
            Effect.map(
              instrument([{ name: 'effect-concurrency/finalizer-escape.ts', content, mutate: true }], {
                ignorers: [],
                excludedMutations: [],
                optInMutations: [SYNCHRONIZATION_REMOVAL],
              }),
              removalMutantsOf,
            ),
        ),
        Then('the one proposed mutant sits on the mask inside the leader lock, word for word')((
          { content, mutants }: { content: string; mutants: readonly Mutant[] },
        ) =>
          Effect.sync(() => {
            expect(mutants.length).toBe(1)
            const [maskMutant] = mutants
            expect(maskMutant?.replacement.startsWith('Effect.suspend(')).toBe(true)
            const range = exportLineRange(content, 'leaderLockScopeClose')
            const sourceLine = (maskMutant?.location.start.line ?? Number.NaN) + 1
            expect(range.firstLine <= sourceLine && sourceLine <= range.lastLine).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'A guard marked as already proven is recorded as skipped, with the reason kept',
      Gherkin.Do.pipe(
        Given('a module whose guard sits under a skip comment giving a reason')(
          'source',
          () => Effect.succeed(SUPPRESSED_SOURCE),
        ),
        When('the file is instrumented with only synchronization removal enabled')(
          'report',
          ({ source }: { source: string }) => instrumentSource(source),
        ),
        Then('the single mutant is reported as skipped, carrying the comment reason')(
          ({ report }: { report: InstrumentResult }) =>
            Effect.sync(() => {
              const mutants = removalMutantsOf(report)
              expect(mutants.length).toBe(1)
              expect(mutants[0]?.status).toBe('Ignored')
              expect(mutants[0]?.statusReason).toBe('the race is proven by the lock suite')
            }),
        ),
      ),
    )
  })
