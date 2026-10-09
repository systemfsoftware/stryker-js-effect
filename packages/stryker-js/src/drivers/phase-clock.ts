import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'

import { phaseDurationsOf, type PhaseMark } from '../phase-durations.js'
import { PhaseClock } from '../run/phase-clock.service.js'

export const layer = (runStartedAt: number): Layer.Layer<PhaseClock> =>
  Layer.effect(
    PhaseClock,
    Effect.gen(function*() {
      const marks = yield* Ref.make<readonly PhaseMark[]>([])
      return PhaseClock.of({
        markAt: (phase, elapsedMs) =>
          Ref.update(marks, (previous): readonly PhaseMark[] => [...previous, { phase, elapsedMs }]),
        durations: Effect.gen(function*() {
          const recorded = yield* Ref.get(marks)
          const now = yield* Clock.currentTimeMillis
          return phaseDurationsOf({ marks: recorded, elapsedMs: now - runStartedAt })
        }),
      })
    }),
  )
