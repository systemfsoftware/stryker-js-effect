import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'

import { effectConcurrencyFixtureFiles, type FixtureFile } from './__fixtures__/effect-concurrency-files.js'
import { instrument } from './__fixtures__/instrument.js'

const ATOMIC_UPDATE_SPLIT = 'AtomicUpdateSplit'
const SYNCHRONIZATION_REMOVAL = 'SynchronizationRemoval'
const FINALIZER_ESCAPE = 'FinalizerEscape'

const CONCURRENCY_MUTATOR_NAMES: readonly string[] = [
  ATOMIC_UPDATE_SPLIT,
  SYNCHRONIZATION_REMOVAL,
  FINALIZER_ESCAPE,
]

const UNKNOWN_MUTATOR_NAME = 'AtomicUpdateSplt'

const MODULE_SOURCE = 'export const total = 1 + 1\n'

const SUPPRESSED_SOURCE = `import { Effect, Ref } from 'effect'

// Stryker disable next-line AtomicUpdateSplit: race proven elsewhere
export const bump = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)
`

interface SubsetSelection {
  readonly label: string
  readonly named: readonly string[]
}

const OPT_IN_SELECTIONS: readonly SubsetSelection[] = [
  { label: 'the atomic-update split alone', named: [ATOMIC_UPDATE_SPLIT] },
  { label: 'the synchronization removal alone', named: [SYNCHRONIZATION_REMOVAL] },
  { label: 'the finalizer escape alone', named: [FINALIZER_ESCAPE] },
  { label: 'the split beside the removal', named: [ATOMIC_UPDATE_SPLIT, SYNCHRONIZATION_REMOVAL] },
  { label: 'the split beside the escape', named: [ATOMIC_UPDATE_SPLIT, FINALIZER_ESCAPE] },
  { label: 'the removal beside the escape', named: [SYNCHRONIZATION_REMOVAL, FINALIZER_ESCAPE] },
  {
    label: 'every concurrency mutator together',
    named: [ATOMIC_UPDATE_SPLIT, SYNCHRONIZATION_REMOVAL, FINALIZER_ESCAPE],
  },
]

interface SelectionOutcome {
  readonly label: string
  readonly named: readonly string[]
  readonly enabled: readonly string[]
  readonly ordinary: readonly string[]
}

interface SelectionRun {
  readonly plainOrdinary: readonly string[]
  readonly choices: readonly SelectionOutcome[]
}

const distinctSorted = (names: readonly string[]): readonly string[] => {
  const sorted = [...names].sort()
  return sorted.filter((name, index) => index === 0 || sorted[index - 1] !== name)
}

const sameNames = (actual: readonly string[], expected: readonly string[]): boolean =>
  distinctSorted(actual).join('|') === distinctSorted(expected).join('|')

const mutatorNamesIn = (result: Instrument.InstrumentResult, keep: (name: string) => boolean): readonly string[] =>
  distinctSorted(result.mutants.filter((mutant) => keep(mutant.mutatorName)).map((mutant) => mutant.mutatorName))

const concurrencyMutatorNamesIn = (result: Instrument.InstrumentResult): readonly string[] =>
  mutatorNamesIn(result, (name) => CONCURRENCY_MUTATOR_NAMES.includes(name))

const ordinaryMutatorNamesIn = (result: Instrument.InstrumentResult): readonly string[] =>
  mutatorNamesIn(result, (name) => !CONCURRENCY_MUTATOR_NAMES.includes(name))

const filesToInstrument = (fixtures: readonly FixtureFile[]) =>
  fixtures.map((fixture) => ({ name: fixture.name, content: fixture.content, mutate: true }))

const concurrencyMutantsIn = (result: Instrument.InstrumentResult): readonly string[] =>
  result.mutants
    .filter((mutant) => CONCURRENCY_MUTATOR_NAMES.includes(mutant.mutatorName))
    .map((mutant) => `${mutant.fileName} ${mutant.mutatorName}`)

const mutantLinesOf = (result: Instrument.InstrumentResult): readonly string[] =>
  result.mutants.map((mutant) =>
    [
      mutant.fileName,
      mutant.id,
      mutant.mutatorName,
      mutant.location.start.line,
      mutant.location.start.column,
      mutant.replacement,
    ].join(' ')
  )

const Feature = makeFeature({ it })

Feature('Choosing extra concurrency mutations by name')
  .live('reads fixture files from disk and parses real source with the oxc parser')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenario }) => {
    scenario(
      'A run that asks for a mutation the library does not have stops with a message naming it',
      Gherkin.Do.pipe(
        Given('a module ready to be instrumented')('source', () => Effect.succeed(MODULE_SOURCE)),
        When('a run asks for a concurrency mutation by a name the library does not offer')(
          'failure',
          ({ source }: { source: string }) =>
            instrument([{ name: 'probe.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
              optInMutations: [UNKNOWN_MUTATOR_NAME],
            }).pipe(Effect.flip),
        ),
        Then('the run fails, and the message names the entry it does not have')((
          { failure }: { failure: Instrument.InstrumentError },
          expect,
        ) => expect(failure.message).toContain(UNKNOWN_MUTATOR_NAME)),
      ),
    )

    scenario(
      'A run that asks for no extra mutation asks for the same run as one that asks for an empty list',
      Gherkin.Do.pipe(
        Given('every Effect concurrency fixture has been read from disk')(
          'fixtures',
          () => effectConcurrencyFixtureFiles,
        ),
        When('the fixtures are instrumented with no list of extra mutations at all')(
          'unlisted',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            instrument(filesToInstrument(fixtures), { ignorers: [], excludedMutations: [] }),
        ),
        When('the fixtures are instrumented with an empty list of extra mutations')(
          'emptyList',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            instrument(filesToInstrument(fixtures), {
              ignorers: [],
              excludedMutations: [],
              optInMutations: [],
            }),
        ),
        Then('neither report holds a concurrency fault, and both hold the same ordinary mutants')((
          { unlisted, emptyList }: { unlisted: Instrument.InstrumentResult; emptyList: Instrument.InstrumentResult },
          expect,
        ) => {
          const unlistedLines = mutantLinesOf(unlisted)
          const emptyLines = mutantLinesOf(emptyList)
          return expect({
            unlistedConcurrency: concurrencyMutantsIn(unlisted),
            emptyListConcurrency: concurrencyMutantsIn(emptyList),
            unlistedNonEmpty: unlistedLines.length > 0,
            emptyEqualsUnlisted: emptyLines.length === unlistedLines.length &&
              emptyLines.every((line, index) => line === unlistedLines[index]),
          }).toEqual({
            unlistedConcurrency: [],
            emptyListConcurrency: [],
            unlistedNonEmpty: true,
            emptyEqualsUnlisted: true,
          })
        }),
      ),
    )

    scenario(
      'A run that names some concurrency mutators turns on exactly the ones it named and nothing else',
      Gherkin.Do.pipe(
        Given('every Effect concurrency fixture has been read from disk')(
          'fixtures',
          () => effectConcurrencyFixtureFiles,
        ),
        When('the fixtures are instrumented once without extras and once for every choice of concurrency mutators')(
          'runs',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            Effect.flatMap(
              instrument(filesToInstrument(fixtures), { ignorers: [], excludedMutations: [] }),
              (plain) =>
                Effect.map(
                  Effect.forEach(OPT_IN_SELECTIONS, (selection) =>
                    Effect.map(
                      instrument(filesToInstrument(fixtures), {
                        ignorers: [],
                        excludedMutations: [],
                        optInMutations: [...selection.named],
                      }),
                      (report): SelectionOutcome => ({
                        label: selection.label,
                        named: selection.named,
                        enabled: concurrencyMutatorNamesIn(report),
                        ordinary: ordinaryMutatorNamesIn(report),
                      }),
                    )),
                  (choices): SelectionRun => ({ plainOrdinary: ordinaryMutatorNamesIn(plain), choices }),
                ),
            ),
        ),
        Then('every choice proposes exactly the faults it named, beside the same ordinary faults')((
          { runs }: { runs: SelectionRun },
          expect,
        ) =>
          expect({
            plainOrdinaryNonEmpty: runs.plainOrdinary.length > 0,
            surprises: runs.choices.flatMap((choice) => [
              ...(sameNames(choice.enabled, choice.named)
                ? []
                : [`${choice.label} enabled ${choice.enabled.join(', ')}`]),
              ...(sameNames(choice.ordinary, runs.plainOrdinary)
                ? []
                : [`${choice.label} turned the ordinary faults into ${choice.ordinary.join(', ')}`]),
            ]),
          }).toEqual({ plainOrdinaryNonEmpty: true, surprises: [] })
        ),
      ),
    )

    scenario(
      'A run that names the same concurrency mutator twice gets the same run as naming it once',
      Gherkin.Do.pipe(
        Given('every Effect concurrency fixture has been read from disk')(
          'fixtures',
          () => effectConcurrencyFixtureFiles,
        ),
        When('the fixtures are instrumented with the split named once and then named twice')(
          'runs',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            Effect.all([
              instrument(filesToInstrument(fixtures), {
                ignorers: [],
                excludedMutations: [],
                optInMutations: [ATOMIC_UPDATE_SPLIT],
              }),
              instrument(filesToInstrument(fixtures), {
                ignorers: [],
                excludedMutations: [],
                optInMutations: [ATOMIC_UPDATE_SPLIT, ATOMIC_UPDATE_SPLIT],
              }),
            ]),
        ),
        Then('both runs propose the identical faults')((
          { runs }: { runs: readonly [Instrument.InstrumentResult, Instrument.InstrumentResult] },
          expect,
        ) => expect(mutantLinesOf(runs[1])).toStrictEqual(mutantLinesOf(runs[0]))),
      ),
    )

    scenario(
      'A note saying a fault is proven elsewhere stays silent while that fault is not asked for',
      Gherkin.Do.pipe(
        Given('a module whose update call sits under a note naming a concurrency fault')(
          'source',
          () => Effect.succeed(SUPPRESSED_SOURCE),
        ),
        When('the module is instrumented without naming that fault')(
          'report',
          ({ source }: { source: string }) =>
            instrument([{ name: '/tmp/opt-in-suppressed-probe.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('the run goes through, and none of the concurrency faults is proposed')((
          { report }: { report: Instrument.InstrumentResult },
          expect,
        ) => expect(concurrencyMutantsIn(report)).toStrictEqual([])),
      ),
    )
  })
