import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { guardedExpect, guardedVi } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const SNAPSHOTS_UNSUPPORTED =
  "Snapshot assertions (toMatchSnapshot, toMatchInlineSnapshot) are not supported by the in-memory 'vm' runner."
const MODULE_MOCK_UNSUPPORTED =
  "vi.mock is not supported by the in-memory 'vm' runner. Use testRunner: 'vitest' for suites that need module mocking."
const HOISTED_MOCK_UNSUPPORTED =
  "vi.hoisted is not supported by the in-memory 'vm' runner. Use testRunner: 'vitest' for suites that need module mocking."

const NO_REFUSAL_WAS_RAISED = 'the call was allowed through'

const refusalOf = (attempt: () => void): string => {
  try {
    attempt()
  } catch (error) {
    if (error instanceof Error) {
      return error.message
    }
    throw error
  }
  return NO_REFUSAL_WAS_RAISED
}

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

const handsThrough = (handedOut: object, member: string, real: object): boolean =>
  Object.is(Reflect.get(handedOut, member), Reflect.get(real, member))

Feature('Assertion helpers handed to a suite that runs in memory')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A stored snapshot comparison is refused with a message naming the in-memory runner',
      Gherkin.Do.pipe(
        Given('a suite holding the assertion helpers the in-memory runner hands out')(
          'assertions',
          () => Effect.succeed(guardedExpect({})),
        ),
        When('it compares against a stored snapshot')(
          'refusal',
          (s) => Effect.sync(() => refusalOf(() => handedAnswer(s.assertions, 'toMatchSnapshot'))),
        ),
        Then('it is refused because snapshots are not kept by the in-memory runner')((s) =>
          Effect.sync(() => {
            expect(s.refusal).toContain(SNAPSHOTS_UNSUPPORTED)
          })
        ),
      ),
    )

    scenario(
      'An inline snapshot comparison is refused with a message naming the in-memory runner',
      Gherkin.Do.pipe(
        Given('a suite holding the assertion helpers the in-memory runner hands out')(
          'assertions',
          () => Effect.succeed(guardedExpect({})),
        ),
        When('it writes an inline snapshot beside its expectation')(
          'refusal',
          (s) => Effect.sync(() => refusalOf(() => handedAnswer(s.assertions, 'toMatchInlineSnapshot'))),
        ),
        Then('it is refused because snapshots are not kept by the in-memory runner')((s) =>
          Effect.sync(() => {
            expect(s.refusal).toContain(SNAPSHOTS_UNSUPPORTED)
          })
        ),
      ),
    )

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
              return { handedOut: guardedExpect(matchers), matchers, answer: () => answerWas }
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
      'Mocking a module is refused with a message naming the runner to use instead',
      Gherkin.Do.pipe(
        Given('a suite holding the mocking helpers the in-memory runner hands out')(
          'mocks',
          () => Effect.succeed(guardedVi({})),
        ),
        When('it mocks a module')('refusal', (s) => Effect.sync(() => refusalOf(() => handedAnswer(s.mocks, 'mock')))),
        Then('it is pointed at the test runner that supports module mocking')((s) =>
          Effect.sync(() => {
            expect(s.refusal).toContain(MODULE_MOCK_UNSUPPORTED)
          })
        ),
      ),
    )

    scenario(
      'Hoisting a mock is refused with a message naming the runner to use instead',
      Gherkin.Do.pipe(
        Given('a suite holding the mocking helpers the in-memory runner hands out')(
          'mocks',
          () => Effect.succeed(guardedVi({})),
        ),
        When('it hoists a mock above its expectations')(
          'refusal',
          (s) => Effect.sync(() => refusalOf(() => handedAnswer(s.mocks, 'hoisted'))),
        ),
        Then('it is pointed at the test runner that supports module mocking')((s) =>
          Effect.sync(() => {
            expect(s.refusal).toContain(HOISTED_MOCK_UNSUPPORTED)
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
              return { handedOut: guardedVi(helpers), helpers, askedFor: () => askedFor }
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
