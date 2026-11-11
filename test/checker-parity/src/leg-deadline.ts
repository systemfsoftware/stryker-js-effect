import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

export interface LegDeadline {
  readonly startedAt: number
  readonly deadlineAt: Option.Option<number>
}

export const remainingOf = (deadline: LegDeadline): Effect.Effect<Option.Option<number>> =>
  Effect.map(Clock.currentTimeMillis, (now) => Option.map(deadline.deadlineAt, (at) => at - now))

export const isPastDeadline = (remaining: Option.Option<number>): boolean => Option.exists(remaining, (ms) => ms <= 0)
