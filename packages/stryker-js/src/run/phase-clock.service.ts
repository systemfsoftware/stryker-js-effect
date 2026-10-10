import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'

import { type CheckerBusyInterval, phaseDurationsOf, type PhaseMark } from '../phase-durations.js'

interface PhaseClockState {
  readonly marks: readonly PhaseMark[]
  readonly checkerBusy: readonly CheckerBusyInterval[]
  readonly checkersConfigured: boolean
}

export interface PhaseClockShape {
  readonly markAt: (phase: RunEvent.RunPhase, elapsedMs: number) => Effect.Effect<void>
  readonly recordCheckerBusy: (interval: CheckerBusyInterval) => Effect.Effect<void>
  readonly markCheckersConfigured: Effect.Effect<void>
  readonly durations: Effect.Effect<Option.Option<RunEvent.PhaseDurations>>
}

export class PhaseClock extends Context.Service<PhaseClock, PhaseClockShape>()(
  '@systemfsoftware/stryker-js/run/phase-clock.service/PhaseClock',
) {
  static readonly layer = (runStartedAt: number): Layer.Layer<PhaseClock> =>
    Layer.effect(
      PhaseClock,
      Effect.gen(function*() {
        const state = yield* Ref.make<PhaseClockState>({ marks: [], checkerBusy: [], checkersConfigured: false })
        return PhaseClock.of({
          markAt: (phase, elapsedMs) =>
            Ref.update(state, (previous): PhaseClockState => ({
              ...previous,
              marks: [...previous.marks, { phase, elapsedMs }],
            })),
          recordCheckerBusy: (interval) =>
            Ref.update(state, (previous): PhaseClockState => ({
              ...previous,
              checkerBusy: [...previous.checkerBusy, interval],
            })),
          markCheckersConfigured: Ref.update(state, (previous): PhaseClockState => ({
            ...previous,
            checkersConfigured: true,
          })),
          durations: Effect.gen(function*() {
            const recorded = yield* Ref.get(state)
            const now = yield* Clock.currentTimeMillis
            return phaseDurationsOf({
              marks: recorded.marks,
              elapsedMs: now - runStartedAt,
              checkerBusy: recorded.checkerBusy,
              checkersConfigured: recorded.checkersConfigured,
            })
          }),
        })
      }),
    )
}
