import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'

import {
  effectConcurrencyFixtureFiles,
  effectConcurrencySelectionFixtureFiles,
  type FixtureFile,
} from './__fixtures__/effect-concurrency-files.js'
import { instrument } from './__fixtures__/instrument.js'

const CONCURRENCY_MUTATORS = ['AtomicUpdateSplit', 'SynchronizationRemoval', 'FinalizerEscape'] as const

const providerNameOf = (name: string): string => `probe/${name}`

const PROVIDER_SPLIT = providerNameOf('AtomicUpdateSplit')
const PROVIDER_REMOVAL = providerNameOf('SynchronizationRemoval')
const PROVIDER_ESCAPE = providerNameOf('FinalizerEscape')

const PROVIDER_NAMES: readonly string[] = [PROVIDER_SPLIT, PROVIDER_REMOVAL, PROVIDER_ESCAPE]

const stockWithoutConcurrency: Mutator.RegistryCatalog = {
  entries: Object.keys(Mutator.defaultMutators)
    .filter((name) => !CONCURRENCY_MUTATORS.some((concurrency) => concurrency === name))
    .map((name) => ({ name, tier: 'default' })),
}

const providerCatalog: Mutator.RegistryCatalog = {
  entries: CONCURRENCY_MUTATORS.map((name) => ({ name: providerNameOf(name), tier: 'optIn' })),
}

const providerContribution: Mutator.RegistryContribution = {
  entries: CONCURRENCY_MUTATORS.map((name) => ({
    name: providerNameOf(name),
    implementation: Mutator.defaultMutators[name],
  })),
}

const registry = Mutator.registryOf([stockWithoutConcurrency, providerCatalog], [providerContribution])

const providerOptions = (optInMutations: readonly string[]): Instrument.InstrumenterOptions => ({
  ignorers: [],
  excludedMutations: [],
  mutantSetPolicy: 'default',
  mutators: Mutator.selectMutators(registry, optInMutations),
})

const SUPPRESSED_SOURCE = `import { Effect, Ref } from 'effect'

// Stryker disable next-line ${PROVIDER_SPLIT}: race proven elsewhere
export const bump = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)
`

interface SubsetSelection {
  readonly label: string
  readonly named: readonly string[]
}

const OPT_IN_SELECTIONS: readonly SubsetSelection[] = [
  { label: 'the provider split alone', named: [PROVIDER_SPLIT] },
  { label: 'the provider removal alone', named: [PROVIDER_REMOVAL] },
  { label: 'the provider escape alone', named: [PROVIDER_ESCAPE] },
  { label: 'the split beside the removal', named: [PROVIDER_SPLIT, PROVIDER_REMOVAL] },
  { label: 'the split beside the escape', named: [PROVIDER_SPLIT, PROVIDER_ESCAPE] },
  { label: 'the removal beside the escape', named: [PROVIDER_REMOVAL, PROVIDER_ESCAPE] },
  { label: 'every provider entry together', named: [PROVIDER_SPLIT, PROVIDER_REMOVAL, PROVIDER_ESCAPE] },
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

const providerMutatorNamesIn = (result: Instrument.InstrumentResult): readonly string[] =>
  mutatorNamesIn(result, (name) => PROVIDER_NAMES.includes(name))

const ordinaryMutatorNamesIn = (result: Instrument.InstrumentResult): readonly string[] =>
  mutatorNamesIn(result, (name) => !PROVIDER_NAMES.includes(name))

const filesToInstrument = (fixtures: readonly FixtureFile[]) =>
  fixtures.map((fixture) => ({ name: fixture.name, content: fixture.content, mutate: true }))

const providerMutantsIn = (result: Instrument.InstrumentResult): readonly string[] =>
  result.mutants
    .filter((mutant) => PROVIDER_NAMES.includes(mutant.mutatorName))
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

Feature("Choosing a plugin provider's opt-in mutations by name")
  .live('reads fixture files from disk and parses real source with the oxc parser')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenario }) => {
    scenario(
      "A run that names no opt-in entry plants none of the provider's opt-in faults",
      Gherkin.Do.pipe(
        Given('every Effect concurrency fixture has been read from disk')(
          'fixtures',
          () => effectConcurrencyFixtureFiles,
        ),
        When('the fixtures are instrumented with a provider whose concurrency entries are opt-in, naming none')(
          'report',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            instrument(filesToInstrument(fixtures), providerOptions([])),
        ),
        Then('the report holds no provider fault, beside ordinary mutants')((
          { report }: { report: Instrument.InstrumentResult },
          expect,
        ) =>
          expect({
            providerMutants: providerMutantsIn(report),
            ordinaryNonEmpty: ordinaryMutatorNamesIn(report).length > 0,
          }).toEqual({ providerMutants: [], ordinaryNonEmpty: true })
        ),
      ),
    )

    scenario(
      'A run that names some opt-in entries turns on exactly the ones it named and nothing else',
      Gherkin.Do.pipe(
        Given(
          'the fixtures holding a placement site for each concurrency mutator, and a bare update holding none, have been read from disk',
        )(
          'fixtures',
          () => effectConcurrencySelectionFixtureFiles,
        ),
        When('the fixtures are instrumented once naming no entry and once for every choice of opt-in entries')(
          'runs',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            Effect.flatMap(
              instrument(filesToInstrument(fixtures), providerOptions([])),
              (plain) =>
                Effect.map(
                  Effect.forEach(OPT_IN_SELECTIONS, (selection) =>
                    Effect.map(
                      instrument(filesToInstrument(fixtures), providerOptions(selection.named)),
                      (report): SelectionOutcome => ({
                        label: selection.label,
                        named: selection.named,
                        enabled: providerMutatorNamesIn(report),
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
      'A run that names the same opt-in entry twice gets the same run as naming it once',
      Gherkin.Do.pipe(
        Given('every Effect concurrency fixture has been read from disk')(
          'fixtures',
          () => effectConcurrencyFixtureFiles,
        ),
        When('the fixtures are instrumented with the provider split named once and then named twice')(
          'runs',
          ({ fixtures }: { fixtures: readonly FixtureFile[] }) =>
            Effect.all([
              instrument(filesToInstrument(fixtures), providerOptions([PROVIDER_SPLIT])),
              instrument(filesToInstrument(fixtures), providerOptions([PROVIDER_SPLIT, PROVIDER_SPLIT])),
            ]),
        ),
        Then('both runs propose the identical faults')((
          { runs }: { runs: readonly [Instrument.InstrumentResult, Instrument.InstrumentResult] },
          expect,
        ) => expect(mutantLinesOf(runs[1])).toStrictEqual(mutantLinesOf(runs[0]))),
      ),
    )

    scenario(
      'A note saying a fault is proven elsewhere stays silent while that opt-in entry is not asked for',
      Gherkin.Do.pipe(
        Given('a module whose update call sits under a note naming a provider opt-in entry')(
          'source',
          () => Effect.succeed(SUPPRESSED_SOURCE),
        ),
        When('the module is instrumented without naming that entry')(
          'report',
          ({ source }: { source: string }) =>
            instrument(
              [{ name: '/tmp/opt-in-suppressed-probe.ts', content: source, mutate: true }],
              providerOptions([]),
            ),
        ),
        Then('the run goes through, and none of the provider faults is proposed')((
          { report }: { report: Instrument.InstrumentResult },
          expect,
        ) => expect(providerMutantsIn(report)).toStrictEqual([])),
      ),
    )
  })
