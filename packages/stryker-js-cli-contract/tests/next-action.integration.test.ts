import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const factsWith = (coveredBy: ReadonlyArray<string> | null): RunEvent.NextActionFacts => ({
  id: Mutant.MutantId.make('00000000000000a7'),
  file: S.toType(Mutant.CanonicalFileName).make('src/lib/price.ts'),
  location: { start: { line: 12, column: 9 }, end: { line: 12, column: 14 } },
  coveredBy,
})

const COVERING = [
  'price.test.ts > rounds',
  'price.test.ts > adds tax',
  'cart.test.ts > totals',
  'cart.test.ts > empties',
]

Feature('Every actionable status names the action that settles it')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A survivor names its first covering tests while measured coverage lasts, and asks for per-test coverage once it does not; a timeout and a runtime error need nothing',
      Gherkin.Do.pipe(
        Given('the facts of a mutant four tests cover, and of one whose run measured no per-test coverage')(
          'facts',
          () => Effect.sync(() => ({ covered: factsWith(COVERING), unmeasured: factsWith(null) })),
        ),
        When('the next action is chosen for each actionable status')(
          'actions',
          (s) =>
            Effect.sync(() => ({
              survived: RunEvent.nextActionOf(s.facts.covered, 'Survived'),
              survivedUnmeasured: RunEvent.nextActionOf(s.facts.unmeasured, 'Survived'),
              noCoverage: RunEvent.nextActionOf(s.facts.unmeasured, 'NoCoverage'),
              timeout: RunEvent.nextActionOf(s.facts.covered, 'Timeout'),
              runtimeError: RunEvent.nextActionOf(s.facts.covered, 'RuntimeError'),
            })),
        ),
        Then('each action carries the fields an agent acts on')((s, expect) =>
          expect(s.actions).toEqual({
            survived: {
              _tag: 'strengthen-tests',
              tests: { total: 4, shown: COVERING.slice(0, 3) },
              reproduce: 'stryker run --mutant 00000000000000a7',
            },
            survivedUnmeasured: {
              _tag: 'fix-config',
              remediation: expect.stringContaining("coverageAnalysis: 'perTest'"),
            },
            noCoverage: { _tag: 'add-test', file: 'src/lib/price.ts', line: 12, column: 9 },
            timeout: { _tag: 'none-needed', why: 'timeout-counts-as-detected' },
            runtimeError: { _tag: 'none-needed', why: 'runtime-error-excluded-from-score' },
          })
        ),
      ),
    )
  })
