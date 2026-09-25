import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Drain, Registry } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const completedOf = (outcome: Drain.DrainOutcome): Drain.DrainCompleted => {
  if (!S.is(Drain.DrainCompleted)(outcome)) throw new Error('expected a completed drain')
  return outcome
}

const registryWith = (register: (registry: Registry.TestRegistry) => void): Registry.TestRegistry => {
  const registry = Registry.createRegistry()
  register(registry)
  return registry
}

Feature('Draining a registered suite into per-test outcomes')
  .withLayer(Layer.empty)
  .live('the drain runs registered test bodies and catches late promise rejections on the host clock')
  .body(({ scenario }) => {
    scenario(
      'A drain with no late rejections reports only the tests that ran',
      Gherkin.Do.pipe(
        Given('a registered suite whose only test passes')(
          'registry',
          () => Effect.sync(() => registryWith((registry) => registry.registerTest('t', [], 'run', false, () => {}))),
        ),
        When('the suite is drained')(
          'outcome',
          (s) => Effect.promise(() => Drain.drainRegistry(s.registry, undefined)),
        ),
        Then('the outcome lists just that test and invents no failure')((s, expect) => {
          const outcome = completedOf(s.outcome)
          return expect({
            count: outcome.tests.length,
            inventedFailure: outcome.tests.some((test) => test.fullName === 'unhandled rejection'),
          }).toEqual({ count: 1, inventedFailure: false })
        }),
      ),
    )

    scenario(
      'A promise that rejects after its test finished is reported as one synthetic failure',
      Gherkin.Do.pipe(
        Given('a registered suite whose only test leaves behind a rejected promise')(
          'registry',
          () =>
            Effect.sync(() =>
              registryWith((registry) =>
                registry.registerTest('t', [], 'run', false, () => {
                  void Promise.reject(new Error('boom'))
                })
              )
            ),
        ),
        When('the suite is drained')(
          'outcome',
          (s) => Effect.promise(() => Drain.drainRegistry(s.registry, undefined)),
        ),
        Then('the outcome lists that test plus one synthetic unhandled-rejection failure')((s, expect) => {
          const outcome = completedOf(s.outcome)
          const synthetic = outcome.tests[1]
          return expect({
            count: outcome.tests.length,
            synthetic: {
              fullName: synthetic?.fullName,
              file: synthetic?.file,
              status: synthetic?.status,
              failureMessage: synthetic?.failureMessage,
              timeSpentMs: synthetic?.timeSpentMs,
            },
          }).toEqual({
            count: 2,
            synthetic: {
              fullName: 'unhandled rejection',
              file: '',
              status: 'failed',
              failureMessage: 'boom',
              timeSpentMs: 0,
            },
          })
        }),
      ),
    )

    scenario(
      'A test expected to fail that passes is reported as a failure',
      Gherkin.Do.pipe(
        Given('a registered suite whose only test is expected to fail but passes')(
          'registry',
          () =>
            Effect.sync(() => registryWith((registry) => registry.registerTest('flaky', [], 'run', true, () => {}))),
        ),
        When('the suite is drained')(
          'outcome',
          (s) => Effect.promise(() => Drain.drainRegistry(s.registry, undefined)),
        ),
        Then('the test is reported as a failure explaining that it should have failed')((s, expect) => {
          const outcome = completedOf(s.outcome)
          return expect({
            count: outcome.tests.length,
            status: outcome.tests[0]?.status,
            failureMessage: outcome.tests[0]?.failureMessage,
          }).toEqual({ count: 1, status: 'failed', failureMessage: 'Expect test to fail' })
        }),
      ),
    )
  })
