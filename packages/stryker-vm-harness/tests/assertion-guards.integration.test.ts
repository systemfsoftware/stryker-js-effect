import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Assertions } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const isCallable = (value: unknown): value is (() => void) | undefined =>
  value === undefined || typeof value === 'function'

const answerIfCallable = <A = unknown>(value: A): void => {
  if (isCallable(value) && value !== undefined) {
    value()
  }
}

const handedAnswer = (handedOut: object, member: string): void => {
  answerIfCallable(Reflect.get(handedOut, member))
}

const memberIsCallable = (handedOut: object, member: string): boolean =>
  typeof Reflect.get(handedOut, member) === 'function'

const handsThrough = (handedOut: object, member: string, real: object): boolean =>
  Object.is(Reflect.get(handedOut, member), Reflect.get(real, member))

Feature('Assertion helpers handed to a suite that runs in memory')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'Any other assertion behaves exactly as it normally does',
      Gherkin.Do.pipe(
        Given('a suite that defines its own matcher and holds the handed-out assertion helpers')(
          'suite',
          () =>
            Effect.sync(() => {
              let answerWas = 0
              const matchers = {
                toBe: (): number => {
                  answerWas = 42
                  return answerWas
                },
              }
              return { handedOut: Assertions.guardedExpect(matchers), matchers, answer: () => answerWas }
            }),
        ),
        When('it applies an ordinary matcher')((s) => Effect.sync(() => handedAnswer(s.suite.handedOut, 'toBe'))),
        Then('the matcher answers on its own and is the one the suite defined')((s) =>
          Effect.sync(() => {
            expect(s.suite.answer()).toBe(42)
            expect(handsThrough(s.suite.handedOut, 'toBe', s.suite.matchers)).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'The mock and hoisted helpers are the ones the suite was handed',
      Gherkin.Do.pipe(
        Given('a suite holding the mocking helpers the in-memory runner hands out')(
          'suite',
          () =>
            Effect.sync(() => {
              const real = { mock: (): string => 'mocked', hoisted: (): string => 'hoisted' }
              return { handedOut: Assertions.guardedVi(real), real }
            }),
        ),
        When('it reads the mock and hoisted helpers from what was handed out')(
          'readable',
          (s) =>
            Effect.sync(() => ({
              mock: memberIsCallable(s.suite.handedOut, 'mock'),
              hoisted: memberIsCallable(s.suite.handedOut, 'hoisted'),
            })),
        ),
        Then('both helpers are callable and are the ones the suite was handed')((s) =>
          Effect.sync(() => {
            expect(s.readable.mock).toBe(true)
            expect(s.readable.hoisted).toBe(true)
            expect(handsThrough(s.suite.handedOut, 'mock', s.suite.real)).toBe(true)
            expect(handsThrough(s.suite.handedOut, 'hoisted', s.suite.real)).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'Any other mocking helper behaves exactly as it normally does',
      Gherkin.Do.pipe(
        Given('a suite that defines its own mock helper and holds the handed-out mocking helpers')(
          'suite',
          () =>
            Effect.sync(() => {
              let askedFor = false
              const helpers = {
                fn: (): string => {
                  askedFor = true
                  return 'mocked'
                },
              }
              return { handedOut: Assertions.guardedVi(helpers), helpers, askedFor: () => askedFor }
            }),
        ),
        When('it asks for its mock helper')((s) => Effect.sync(() => handedAnswer(s.suite.handedOut, 'fn'))),
        Then('the helper receives the call and is the one the suite defined')((s) =>
          Effect.sync(() => {
            expect(s.suite.askedFor()).toBe(true)
            expect(handsThrough(s.suite.handedOut, 'fn', s.suite.helpers)).toBe(true)
          })
        ),
      ),
    )
  })
