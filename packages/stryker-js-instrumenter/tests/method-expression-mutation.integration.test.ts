import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Instrument } from '@systemfsoftware/stryker-js-instrumenter'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

const OBJECT_PROTOTYPE_MEMBERS: readonly string[] = [
  'toString',
  'valueOf',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
]

const SOURCE = OBJECT_PROTOTYPE_MEMBERS
  .map((member, index) => `export const v${index} = String(globalThis).${member}()`)
  .join('\n')

const Feature = makeFeature({ it, layer })

Feature('Mutating a method named after an Object.prototype member')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'Prototype-named method calls instrument without proposing a method replacement',
      Gherkin.Do.pipe(
        Given('a module calling each prototype-named method')('source', () => Effect.succeed(SOURCE)),
        When('it is instrumented')(
          'result',
          ({ source }: { source: string }) =>
            Instrument.instrument([{ name: '/tmp/prototype-methods.ts', content: source, mutate: true }], {
              ignorers: [],
              excludedMutations: [],
            }),
        ),
        Then('instrumentation succeeds and proposes no method replacement')((
          { result }: { result: Instrument.InstrumentResult },
        ) =>
          Effect.sync(() => {
            const methodMutants = result.mutants.filter((mutant) => mutant.mutatorName === 'MethodExpression')
            expect(methodMutants).toEqual([])
          })
        ),
      ),
    )
  })
