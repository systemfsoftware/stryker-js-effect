import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as TestClock from 'effect/testing/TestClock'

import { bootPingWorker, timeoutOf, WORKER_PID } from './__fixtures__/substituted-worker.fixture.js'

const Feature = makeFeature({ it })

Feature('Reporting a plugin worker that never accepts its connection')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A worker that never accepts the connection is reported, not hung on',
      Gherkin.Do.pipe(
        Given('a plugin whose own worker entry never accepts a connection')(
          'booting',
          () => bootPingWorker('neverBinds').pipe(Effect.forkChild),
        ),
        When('the host waits out the boot window without a connection')(
          'boot',
          (s) =>
            TestClock.adjust(Duration.minutes(1)).pipe(
              Effect.andThen(Effect.yieldNow),
              Effect.andThen(Effect.suspend(() =>
                s.booting.pollUnsafe() === undefined
                  ? Effect.die(new Error('the host was still waiting on a worker that never accepted its connection'))
                  : Fiber.join(s.booting)
              )),
            ),
        ),
        Then(
          'within a minute of boot, the host reports the worker never came up, naming the child it started',
        )((s, expect) => expect(timeoutOf(s.boot).pid).toEqual(WORKER_PID)),
      ),
    )
  })
