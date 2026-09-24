import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Session } from '@systemfsoftware/stryker-vm-harness'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const TERMINATED_MESSAGE = 'the vm harness worker was terminated'

const outcomeOf = (pending: Promise<Session.VmRunResponse>): Promise<string> =>
  pending.then(() => 'answered', (cause: Error) => cause.message)

Feature('Stopping a runner worker while a check is still waiting')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A check that is still waiting fails once the worker is stopped',
      Gherkin.Do.pipe(
        Given('a worker for a session with no test files')(
          'client',
          () =>
            Effect.sync(() =>
              Session.createVmWorkerClient({ sandboxWorkingDirectory: import.meta.dirname, testFiles: [] })
            ),
        ),
        When('a check starts and the worker is stopped before it answers')(
          'outcome',
          (s) =>
            Effect.promise(() => {
              const pending = s.client.run({ kind: 'dry', timeoutMs: 1000, reloadEnvironment: false })
              const stopped = s.client.terminate()
              return Promise.all([outcomeOf(pending), stopped]).then(([outcome]) => outcome)
            }),
        ),
        Then('the check fails with the worker-stopped notice rather than waiting forever')((s) =>
          Effect.sync(() => {
            expect(s.outcome).toBe(TERMINATED_MESSAGE)
          })
        ),
      ),
    )
  })
