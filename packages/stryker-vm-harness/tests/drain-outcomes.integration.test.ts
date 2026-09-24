import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Drain, Registry } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as S from 'effect/Schema'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const completedOf = (outcome: Drain.DrainOutcome): Drain.DrainCompleted => {
  if (!S.is(Drain.DrainCompleted)(outcome)) throw new Error('expected a completed drain')
  return outcome
}

Feature('Draining a registered suite into per-test outcomes')
  .withLayer(Layer.empty)
  .liveClock()
  .body(({ scenario }) => {
    scenario(
      'A drain with no late rejections reports only the tests that ran',
      Gherkin.Do.pipe(
        Given('a registered suite whose only test passes')(
          'registry',
          () =>
            Effect.sync(() => {
              const registry = Registry.createRegistry()
              registry.registerTest('t', [], 'run', false, () => {})
              return registry
            }),
        ),
        When('the suite is drained')(
          'outcome',
          (s) => Effect.promise(() => Drain.drainRegistry(s.registry, undefined)),
        ),
        Then('the outcome lists just that test and invents no failure')((s) =>
          Effect.sync(() => {
            const outcome = completedOf(s.outcome)
            expect(outcome.tests.length).toBe(1)
            expect(outcome.tests.some((test) => test.fullName === 'unhandled rejection')).toBe(false)
          })
        ),
      ),
    )

    scenario(
      'A promise that rejects after its test finished is reported as one synthetic failure',
      Gherkin.Do.pipe(
        Given('a registered suite whose only test leaves behind a rejected promise')(
          'registry',
          () =>
            Effect.sync(() => {
              const registry = Registry.createRegistry()
              registry.registerTest('t', [], 'run', false, () => {
                void Promise.reject(new Error('boom'))
              })
              return registry
            }),
        ),
        When('the suite is drained')(
          'outcome',
          (s) => Effect.promise(() => Drain.drainRegistry(s.registry, undefined)),
        ),
        Then('the outcome lists that test plus one synthetic unhandled-rejection failure')((s) =>
          Effect.sync(() => {
            const outcome = completedOf(s.outcome)
            expect(outcome.tests.length).toBe(2)
            const synthetic = outcome.tests[1]
            expect(synthetic?.fullName).toBe('unhandled rejection')
            expect(synthetic?.file).toBe('')
            expect(synthetic?.status).toBe('failed')
            expect(synthetic?.failureMessage).toBe('boom')
            expect(synthetic?.timeSpentMs).toBe(0)
          })
        ),
      ),
    )

    scenario(
      'A test expected to fail that passes is reported as a failure',
      Gherkin.Do.pipe(
        Given('a registered suite whose only test is expected to fail but passes')(
          'registry',
          () =>
            Effect.sync(() => {
              const registry = Registry.createRegistry()
              registry.registerTest('flaky', [], 'run', true, () => {})
              return registry
            }),
        ),
        When('the suite is drained')(
          'outcome',
          (s) => Effect.promise(() => Drain.drainRegistry(s.registry, undefined)),
        ),
        Then('the test is reported as a failure explaining that it should have failed')((s) =>
          Effect.sync(() => {
            const outcome = completedOf(s.outcome)
            expect(outcome.tests.length).toBe(1)
            expect(outcome.tests[0]?.status).toBe('failed')
            expect(outcome.tests[0]?.failureMessage).toBe('flaky was expected to fail, but passed')
          })
        ),
      ),
    )
  })
