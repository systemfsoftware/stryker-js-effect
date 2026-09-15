import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { angularIgnorer } from '@systemfsoftware/stryker-js-instrumenter'
import type { InstrumentResult } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { instrument } from './__fixtures__/instrument.js'

const ANGULAR_SOURCE = `class C {
  foo = input.required({ required: true })
  bar = viewChild(BarToken, { read: BarToken })
  baz = compute({ keep: 1 })
}
`

const INPUT_MODEL_OUTPUT_CONFIG_MSG =
  'Angular signal based input, model and output functions configuration object cannot be mutated as that causes issues with the Angular compiler.'
const SIGNAL_QUERY_OPTIONS_MSG =
  'Angular signal query options object cannot be mutated as that causes issues with the Angular compiler.'

const Feature = makeFeature({ it, layer })

Feature('Angular signal configuration objects')
  .body(({ scenario }) => {
    scenario(
      'Signal configuration objects are ignored while a plain object keeps its mutants',
      Gherkin.Do.pipe(
        Given('a class holding a signal input config, a signal query config and a plain object')(
          'source',
          () => Effect.succeed(ANGULAR_SOURCE),
        ),
        When('it is instrumented with the Angular ignorer')(
          'result',
          ({ source }: { source: string }) =>
            instrument([{ name: '/tmp/probe/angular.ts', content: source, mutate: true }], {
              ignorers: [angularIgnorer],
              excludedMutations: [],
            }),
        ),
        Then('the two signal configs are ignored and the plain object is not')((
          { result }: { result: InstrumentResult },
        ) =>
          Effect.sync(() => {
            const reasons = result.mutants
              .filter((mutant) => mutant.status === 'Ignored')
              .map((mutant) => mutant.statusReason)
            expect(
              reasons.every(
                (reason) => reason === INPUT_MODEL_OUTPUT_CONFIG_MSG || reason === SIGNAL_QUERY_OPTIONS_MSG,
              ),
            ).toBe(true)
            expect(reasons).toContain(INPUT_MODEL_OUTPUT_CONFIG_MSG)
            expect(reasons).toContain(SIGNAL_QUERY_OPTIONS_MSG)

            const objectLiterals = result.mutants.filter((mutant) => mutant.mutatorName === 'ObjectLiteral')
            expect(objectLiterals.filter((mutant) => mutant.status === 'Ignored')).toHaveLength(2)
            expect(objectLiterals.filter((mutant) => mutant.status !== 'Ignored')).toHaveLength(1)
          })
        ),
      ),
    )
  })
