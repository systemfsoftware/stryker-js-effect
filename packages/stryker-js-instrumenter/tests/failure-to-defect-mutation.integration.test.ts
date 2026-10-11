import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Effect } from 'effect'

import { instrument, stockOptions } from './__fixtures__/instrument.js'

const FAILURE_TO_DEFECT = 'FailureToDefect'

const NAMESPACE_SOURCE = `import * as E from 'effect/Effect'

class NotFound {
  readonly _tag = 'NotFound'
}

export const lookup = (found: boolean) => (found ? E.succeed(1) : E.fail(new NotFound()))
`

const GENERATOR_SOURCE = `import { Effect } from 'effect'

export const lookup = (found: boolean, missing: Error) =>
  Effect.gen(function*() {
    if (!found) {
      yield* Effect.fail(missing)
    }
    return 1
  })
`

const LITERAL_CASES = [
  { site: 'namespace-imported failure', source: NAMESPACE_SOURCE, replacement: 'E.die(new NotFound())' },
  { site: 'failure yielded inside a generator', source: GENERATOR_SOURCE, replacement: 'Effect.die(missing)' },
] as const

const LOCAL_FAIL_SOURCE = `const fail = (reason: string) => ({ ok: false, reason })

export const lookup = () => fail('missing')
`

const SHADOWED_EFFECT_SOURCE = `import { Effect } from 'effect'

export const shadowed = (Effect: { fail: (reason: string) => string }) => Effect.fail('missing')
`

const BARE_FAIL_SOURCE = `import { fail } from 'effect/Effect'

export const lookup = (reason: string) => fail(reason)
`

const REFUSAL_CASES = [
  { situation: 'a local helper sharing the covered name', source: LOCAL_FAIL_SOURCE },
  { situation: 'an Effect parameter shadowing the import', source: SHADOWED_EFFECT_SOURCE },
  { situation: 'a bare fail import with no Effect module in scope to reach die', source: BARE_FAIL_SOURCE },
] as const

const instrumentSource = (source: string) =>
  instrument(
    [{ name: '/tmp/failure-to-defect-probe.ts', content: source, mutate: true }],
    stockOptions({ ignorers: [], excludedMutations: [] }),
  )

const defectMutantsOf = (result: { readonly mutants: readonly Mutant.Mutant[] }): readonly Mutant.Mutant[] =>
  result.mutants.filter((mutant) => mutant.mutatorName === FAILURE_TO_DEFECT)

const Feature = makeFeature({ it })

Feature('Exposing untested error channels by raising typed failures as defects')
  .live('parses real source with the oxc parser')
  .withLayer(NodeFileSystem.layer)
  .body(({ scenarioOutline }) => {
    scenarioOutline(
      'The <site> becomes a defect word for word, keeping its argument',
      LITERAL_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given('a module with one typed failure')('source', () => Effect.succeed(row.source)),
          When('the module is instrumented with the default mutators')(
            'mutants',
            ({ source }: { source: string }) => Effect.map(instrumentSource(source), defectMutantsOf),
          ),
          Then('the one proposed mutant spells the defect word for word')(
            ({ mutants }: { mutants: readonly Mutant.Mutant[] }, expect) =>
              expect(mutants.map((mutant) => mutant.replacement)).toEqual([row.replacement]),
          ),
        ),
    )

    scenarioOutline(
      'A <situation> is left alone',
      REFUSAL_CASES,
      (row) =>
        Gherkin.Do.pipe(
          Given(row.situation)('source', () => Effect.succeed(row.source)),
          When('the module is instrumented with the default mutators')(
            'count',
            ({ source }: { source: string }) =>
              Effect.map(instrumentSource(source), (result) => defectMutantsOf(result).length),
          ),
          Then('no mutant is proposed')(({ count }: { count: number }, expect) => expect(count).toBe(0)),
        ),
    )
  })
