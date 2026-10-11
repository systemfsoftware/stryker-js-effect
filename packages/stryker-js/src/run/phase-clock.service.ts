import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'

import {
  type CheckerBusyInterval,
  checkerBusyIntervalOf,
  type CheckerBusyReading,
  type PhaseMark,
} from '../phase-durations.schema.js'
import { phaseDurations, PhaseDurationsCommand, type PhaseDurationsDecision } from '../phase-durations.workflow.js'

interface PhaseClockState {
  readonly marks: readonly PhaseMark[]
  readonly checkerBusy: readonly CheckerBusyInterval[]
  readonly checkersConfigured: boolean
}

export interface PhaseClockShape {
  readonly markAt: (phase: RunEvent.RunPhase, elapsedMs: number) => Effect.Effect<void>
  readonly recordCheckerBusy: (reading: CheckerBusyReading) => Effect.Effect<void>
  readonly markCheckersConfigured: Effect.Effect<void>
  readonly durations: Effect.Effect<Option.Option<RunEvent.PhaseDurations>>
}

const durationsOfDecision = (decision: PhaseDurationsDecision): Option.Option<RunEvent.PhaseDurations> =>
  Match.valueTags(decision, {
    PhaseDurationsComputed: ({ durations }) => Option.some(durations),
    PhaseMarksMissing: () => Option.none<RunEvent.PhaseDurations>(),
  })

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
          recordCheckerBusy: (reading) =>
            Ref.update(state, (previous): PhaseClockState => ({
              ...previous,
              checkerBusy: [...previous.checkerBusy, checkerBusyIntervalOf(reading)],
            })),
          markCheckersConfigured: Ref.update(state, (previous): PhaseClockState => ({
            ...previous,
            checkersConfigured: true,
          })),
          durations: Effect.gen(function*() {
            const recorded = yield* Ref.get(state)
            const now = yield* Clock.currentTimeMillis
            return durationsOfDecision(
              Result.getOrElse(
                phaseDurations(
                  PhaseDurationsCommand.make({
                    marks: recorded.marks,
                    elapsedMs: now - runStartedAt,
                    checkerBusy: recorded.checkerBusy,
                    checkersConfigured: recorded.checkersConfigured,
                  }),
                ),
                (never: never) => never,
              ),
            )
          }),
        })
      }),
    )
}
