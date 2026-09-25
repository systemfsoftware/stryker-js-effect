import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Assertions } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const Feature = makeFeature({ it })

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
        Then('the matcher answers on its own and is the one the suite defined')((s, expect) =>
          expect({
            answer: s.suite.answer(),
            shared: handsThrough(s.suite.handedOut, 'toBe', s.suite.matchers),
          }).toEqual({ answer: 42, shared: true })
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
        Then('both helpers are callable and are the ones the suite was handed')((s, expect) =>
          expect({
            mock: s.readable.mock,
            hoisted: s.readable.hoisted,
            mockShared: handsThrough(s.suite.handedOut, 'mock', s.suite.real),
            hoistedShared: handsThrough(s.suite.handedOut, 'hoisted', s.suite.real),
          }).toEqual({ mock: true, hoisted: true, mockShared: true, hoistedShared: true })
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
        Then('the helper receives the call and is the one the suite defined')((s, expect) =>
          expect({
            asked: s.suite.askedFor(),
            shared: handsThrough(s.suite.handedOut, 'fn', s.suite.helpers),
          }).toEqual({ asked: true, shared: true })
        ),
      ),
    )

    scenario(
      'A dispatching assertion hands out the same matchers however it is called',
      Gherkin.Do.pipe(
        Given('a real assertion helper and the factory that builds one for a test')(
          'suite',
          () =>
            Effect.sync(() => {
              const real = { toBe: (): string => 'answered' }
              const createExpect = (): object => real
              return {
                last: Assertions.dispatchingExpect(createExpect)(real),
                first: Assertions.dispatchingExpect(real, createExpect),
                real,
              }
            }),
        ),
        When('it reads the matcher from each handed-out assertion')(
          'readable',
          (s) =>
            Effect.sync(() => ({
              last: memberIsCallable(s.suite.last, 'toBe'),
              first: memberIsCallable(s.suite.first, 'toBe'),
            })),
        ),
        Then('both carry the matchers of the real assertion')((s, expect) =>
          expect({
            last: s.readable.last,
            first: s.readable.first,
            lastShared: handsThrough(s.suite.last, 'toBe', s.suite.real),
            firstShared: handsThrough(s.suite.first, 'toBe', s.suite.real),
          }).toEqual({ last: true, first: true, lastShared: true, firstShared: true })
        ),
      ),
    )
  })
