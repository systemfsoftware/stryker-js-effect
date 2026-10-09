import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'

import { phaseDurationsOf, type PhaseMark } from '../phase-durations.js'

export interface FirstScored {
  readonly elapsedMs: number
  readonly costMs: number
}

export interface PhaseClockShape {
  readonly markAt: (phase: RunEvent.RunPhase, elapsedMs: number) => Effect.Effect<void>
  readonly durations: Effect.Effect<Option.Option<RunEvent.PhaseDurations>>
  readonly markScored: (costMs: number) => Effect.Effect<void>
  readonly firstScored: Effect.Effect<Option.Option<FirstScored>>
}

export class PhaseClock extends Context.Service<PhaseClock, PhaseClockShape>()(
  '@systemfsoftware/stryker-js/run/phase-clock.service/PhaseClock',
) {
  static readonly layer = (runStartedAt: number): Layer.Layer<PhaseClock> =>
    Layer.effect(
      PhaseClock,
      Effect.gen(function*() {
        const marks = yield* Ref.make<readonly PhaseMark[]>([])
        const scored = yield* Ref.make<Option.Option<FirstScored>>(Option.none())
        return PhaseClock.of({
          markAt: (phase, elapsedMs) =>
            Ref.update(marks, (previous): readonly PhaseMark[] => [...previous, { phase, elapsedMs }]),
          durations: Effect.gen(function*() {
            const recorded = yield* Ref.get(marks)
            const now = yield* Clock.currentTimeMillis
            return phaseDurationsOf({ marks: recorded, elapsedMs: now - runStartedAt })
          }),
          markScored: (costMs) =>
            Effect.flatMap(Clock.currentTimeMillis, (now) =>
              Ref.update(scored, (first) =>
                Option.orElse(first, () =>
                  Option.some({ elapsedMs: now - runStartedAt, costMs })))),
          firstScored: Ref.get(scored),
        })
      }),
    )
}
