import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Option from 'effect/Option'

export interface PhaseClockShape {
  readonly markAt: (phase: RunEvent.RunPhase, elapsedMs: number) => Effect.Effect<void>
  readonly durations: Effect.Effect<Option.Option<RunEvent.PhaseDurations>>
}

export class PhaseClock extends Context.Service<PhaseClock, PhaseClockShape>()(
  '@systemfsoftware/stryker-js/run/phase-clock.service/PhaseClock',
) {}
