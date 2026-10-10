import { Run } from '@systemfsoftware/stryker-js-contracts'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'

export const layer = (runStartedAt: number): Layer.Layer<Run.PhaseClock> =>
  Layer.effect(
    Run.PhaseClock,
    Effect.gen(function*() {
      const marks = yield* Ref.make<readonly Run.PhaseMark[]>([])
      return Run.PhaseClock.of({
        markAt: (phase, elapsedMs) =>
          Ref.update(marks, (previous): readonly Run.PhaseMark[] => [...previous, { phase, elapsedMs }]),
        durations: Effect.gen(function*() {
          const recorded = yield* Ref.get(marks)
          const now = yield* Clock.currentTimeMillis
          return Run.phaseDurationsOf({ marks: recorded, elapsedMs: now - runStartedAt })
        }),
      })
    }),
  )
