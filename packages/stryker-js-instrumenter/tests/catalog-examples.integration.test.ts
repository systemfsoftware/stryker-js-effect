import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { StockCatalog } from '@systemfsoftware/stryker-js-cli-contract'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Layer } from 'effect'

interface AuthoredExample {
  readonly before: string
  readonly after: readonly string[]
}

interface CatalogEntry {
  readonly id: string
  readonly name: string
  readonly tier: string
  readonly examples: readonly AuthoredExample[]
}

const STOCK_CATALOG: readonly CatalogEntry[] = StockCatalog.StockCatalog.entries

const STOCK_NAMES: readonly string[] = [
  ...Object.keys(Mutator.stockRegistry.defaults),
  ...Object.keys(Mutator.stockRegistry.optIn),
].sort()

const IMPLEMENTATIONS: Readonly<Record<string, Mutator.Mutator>> = {
  ...Mutator.stockRegistry.defaults,
  ...Mutator.stockRegistry.optIn,
}

const onlyThese = (names: readonly string[]): Mutator.MutatorSelection => ({
  active: names.map((name) => {
    const implementation = IMPLEMENTATIONS[name]
    if (implementation === undefined) {
      throw new Error(`the stock registry implements no mutator named "${name}"`)
    }
    return [name, implementation] as const
  }),
  known: [...names],
})

const fileNameOf = (entry: CatalogEntry, index: number): string => `catalog/${entry.id}-${index}.ts`

type CollectedMutants = Instrument.InstrumentResult['mutants']

interface EntryRun {
  readonly entry: CatalogEntry
  readonly mutants: CollectedMutants
}

const runEntries = (
  entries: readonly CatalogEntry[],
  namesOf: (entry: CatalogEntry) => readonly string[],
): Effect.Effect<readonly EntryRun[], Instrument.InstrumentError> =>
  Effect.forEach(entries, (entry) =>
    Effect.map(
      Instrument.instrument(
        entry.examples.map((example, index) => ({
          name: fileNameOf(entry, index),
          content: example.before,
          mutate: true,
        })),
        { ignorers: [], excludedMutations: [], mutators: onlyThese(namesOf(entry)) },
      ),
      (result: Instrument.InstrumentResult): EntryRun => ({ entry, mutants: result.mutants }),
    ))

const replacementsIn = (run: EntryRun, index: number): readonly string[] =>
  run.mutants.filter((mutant) => mutant.fileName === fileNameOf(run.entry, index)).map((mutant) => mutant.replacement)

const disagrees = (left: readonly string[], right: readonly string[]): boolean =>
  left.length !== right.length || left.some((value, index) => value !== right[index])

const withOneExample = (entry: CatalogEntry, index: number, label: string): CatalogEntry => {
  const example = entry.examples[index]
  if (example === undefined) {
    throw new Error(`the catalog entry "${entry.id}" has no example ${index}`)
  }
  return { ...entry, id: `${entry.id}-${label}`, examples: [example] }
}

const withoutReplacement = (): readonly CatalogEntry[] =>
  STOCK_CATALOG.flatMap((entry) =>
    entry.examples.flatMap((example, index) =>
      example.after.length === 0 ? [withOneExample(entry, index, `no-replacement-${index}`)] : []
    )
  )

const firstReplacementOf = (entry: CatalogEntry): CatalogEntry | undefined => {
  const index = entry.examples.findIndex((example) => example.after.length > 0)
  return index === -1 ? undefined : withOneExample(entry, index, 'first-replacement')
}

const optInEntries = (): readonly CatalogEntry[] =>
  STOCK_CATALOG.filter((entry) => entry.tier === 'optIn').flatMap((entry) => {
    const probe = firstReplacementOf(entry)
    return probe === undefined ? [] : [probe]
  })

const Feature = makeFeature({ it })

Feature('The stock mutations this instrumenter promises')
  .live('parses real source with the oxc parser loaded at run time')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'Each authored example is exactly what its entry proposes for it',
      Gherkin.Do.pipe(
        Given('the stock catalog the product contract publishes')(
          'entries',
          () => Effect.succeed<readonly CatalogEntry[]>(STOCK_CATALOG),
        ),
        When('every entry is instrumented over its own examples and nothing else')(
          'runs',
          ({ entries }: { entries: readonly CatalogEntry[] }) => runEntries(entries, (entry) => [entry.name]),
        ),
        Then('the proposals match the authored replacements, entry for entry')((
          { runs }: { runs: readonly EntryRun[] },
          expect,
        ) => {
          const rows = runs.flatMap((run) =>
            run.entry.examples.map((example, index) => ({
              entry: run.entry.id,
              name: run.entry.name,
              example: index,
              before: example.before,
              authored: [...example.after],
              proposed: replacementsIn(run, index),
            }))
          )
          const checked = [...new Set(rows.map((row) => row.name))].sort()
          return expect({
            disagreements: rows.filter((row) => disagrees(row.authored, row.proposed)),
            checked,
            implemented: STOCK_NAMES,
          }).toStrictEqual({ disagreements: [], checked: STOCK_NAMES, implemented: STOCK_NAMES })
        }),
      ),
    )

    scenario(
      'An extra mutation stays out of a run that does not name it',
      Gherkin.Do.pipe(
        Given('every opt-in entry and one example that it replaces')(
          'probes',
          () => Effect.succeed<readonly CatalogEntry[]>(optInEntries()),
        ),
        When('each example is instrumented without that entry and then with it')(
          'observed',
          ({ probes }: { probes: readonly CatalogEntry[] }) =>
            Effect.map(
              Effect.forEach(probes, (probe) =>
                Effect.map(
                  Effect.all([
                    runEntries([probe], () => Object.keys(Mutator.stockRegistry.defaults)),
                    runEntries([probe], () => [probe.name]),
                  ]),
                  ([unselected, selected]) => ({ probe, unselected, selected }),
                )),
              (runs) =>
                runs.map(({ probe, unselected, selected }) => ({
                  entry: probe.id,
                  unselected: unselected.flatMap((run) =>
                    run.mutants
                      .filter((mutant) => mutant.mutatorName === probe.name)
                      .map((mutant) => mutant.replacement)
                  ),
                  proposed: selected.flatMap((run) =>
                    run.mutants.filter((mutant) => mutant.mutatorName === probe.name)
                  ).length,
                })),
            ),
        ),
        Then('the unnamed run proposes none of them and the named run proposes some')((
          { observed }: {
            readonly observed: readonly {
              readonly entry: string
              readonly unselected: readonly string[]
              readonly proposed: number
            }[]
          },
          expect,
        ) =>
          expect({
            entries: observed.map((row) => row.entry),
            unselected: observed.flatMap((row) => row.unselected),
            everyNamedRunProposed: observed.every((row) => row.proposed > 0),
          }).toStrictEqual({
            entries: optInEntries().map((probe) => probe.id),
            unselected: [],
            everyNamedRunProposed: true,
          })
        ),
      ),
    )

    scenario(
      'A snippet an entry must not mutate yields nothing',
      Gherkin.Do.pipe(
        Given('every example the catalog authors with no replacement')(
          'entries',
          () => Effect.succeed<readonly CatalogEntry[]>(withoutReplacement()),
        ),
        When('each one is instrumented with only its own entry selected')(
          'runs',
          ({ entries }: { entries: readonly CatalogEntry[] }) => runEntries(entries, (entry) => [entry.name]),
        ),
        Then('no entry proposes anything at all')((
          { runs }: { runs: readonly EntryRun[] },
          expect,
        ) =>
          expect(runs.flatMap((run) => run.mutants.map((mutant) => `${run.entry.id}: ${mutant.mutatorName}`)))
            .toStrictEqual([])
        ),
      ),
    )
  })
