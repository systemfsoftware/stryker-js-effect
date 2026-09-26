import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ModeSignal, OutputMode } from './output-mode.schema.js'
import { RunEvent } from './run-event.schema.js'

const FrameRunEventTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/FrameRunEventDecision',
)
type FrameRunEventTypeId = typeof FrameRunEventTypeId

export const FramingState = S.Struct({
  mode: OutputMode,
  signal: ModeSignal,
  headerWritten: S.Boolean,
  terminalSeen: S.Boolean,
  completed: Report.NonNegativeInt,
  total: S.NullOr(Report.NonNegativeInt),
})
export type FramingState = typeof FramingState.Type

export class FrameRunEventCommand extends S.TaggedClass<FrameRunEventCommand>()(
  'FrameRunEventCommand',
  {
    state: FramingState,
    event: RunEvent,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class EventFramed extends S.TaggedClass<EventFramed>()('EventFramed', {
  state: FramingState,
  event: RunEvent,
  stderrLine: S.NullOr(S.String),
}) {
  readonly [FrameRunEventTypeId] = FrameRunEventTypeId
}

export class EventSuppressed extends S.TaggedClass<EventSuppressed>()(
  'EventSuppressed',
  {
    state: FramingState,
    stderrLine: S.NullOr(S.String),
  },
) {
  readonly [FrameRunEventTypeId] = FrameRunEventTypeId
}

export type FrameRunEventDecision = EventFramed | EventSuppressed

export const ResolvedModeInput = S.Struct({
  mode: OutputMode,
  signal: ModeSignal,
})
export type ResolvedModeInput = typeof ResolvedModeInput.Type

const nextFramingState = (state: FramingState, event: RunEvent): FramingState =>
  Match.value(event).pipe(
    Match.tag('verdict', 'error', 'help', () =>
      FramingState.make({
        mode: state.mode,
        signal: state.signal,
        headerWritten: state.headerWritten,
        terminalSeen: true,
        completed: state.completed,
        total: state.total,
      })),
    Match.tag('plan', (e) =>
      FramingState.make({
        mode: state.mode,
        signal: state.signal,
        headerWritten: state.headerWritten,
        terminalSeen: state.terminalSeen,
        completed: state.completed,
        total: e.total,
      })),
    Match.tag('mutantTested', (e) =>
      FramingState.make({
        mode: state.mode,
        signal: state.signal,
        headerWritten: state.headerWritten,
        terminalSeen: state.terminalSeen,
        completed: e.completed,
        total: e.total,
      })),
    Match.tag('stream', () => state),
    Match.tag('phase', () => state),
    Match.tag('tick', () => state),
    Match.tag('plugins', () => state),
    Match.tag('formats', () => state),
    Match.tag('skipped', () => state),
    Match.exhaustive,
  )

const noteState = (state: FramingState, event: RunEvent): FramingState => nextFramingState(state, event)

const formatScore = (score: number | null): string =>
  Option.match(Option.fromNullishOr(score), {
    onNone: () => 'n/a',
    onSome: (val) => String(val),
  })

const formatTotal = (total: number | null): string =>
  Option.match(Option.fromNullishOr(total), {
    onNone: () => '?',
    onSome: (val) => String(val),
  })

const formatStderrEvent = (event: RunEvent): string | null =>
  Match.value(event).pipe(
    Match.tag('plan', (e) => `plan ${e.total} mutants`),
    Match.tag('phase', (e) => `phase ${e.phase}`),
    Match.tag(
      'tick',
      (e) => `${e.completed}/${formatTotal(e.total)} elapsed ${e.elapsedMs}ms`,
    ),
    Match.tag(
      'verdict',
      (e) => `score ${formatScore(e.score)} killed ${e.counts.killed} survived ${e.counts.survived}`,
    ),
    Match.tag('error', (e) => `error ${e.error}`),
    Match.tag('stream', () => null),
    Match.tag('mutantTested', () => null),
    Match.tag('help', () => null),
    Match.tag('plugins', () => null),
    Match.tag('formats', () => null),
    Match.tag('skipped', () => null),
    Match.exhaustive,
  )

const stderrLineFor = (state: FramingState, event: RunEvent): string | null =>
  Boolean.match(Boolean.and(state.mode === 'human', !state.terminalSeen), {
    onTrue: () => formatStderrEvent(event),
    onFalse: () => null,
  })

const shouldFrame = (state: FramingState): boolean => !state.terminalSeen

const decideFrame = (
  command: FrameRunEventCommand,
): Result.Result<FrameRunEventDecision, never> => {
  const nextState = noteState(command.state, command.event)
  const stderrLine = stderrLineFor(command.state, command.event)
  const framed = shouldFrame(command.state)

  return Match.value(framed).pipe(
    Match.when(true, () =>
      Result.succeed(
        EventFramed.make({
          state: nextState,
          event: command.event,
          stderrLine,
        }),
      )),
    Match.when(false, () =>
      Result.succeed(
        EventSuppressed.make({
          state: nextState,
          stderrLine,
        }),
      )),
    Match.exhaustive,
  )
}

export const frameRunEvent = Workflow.make({
  command: FrameRunEventCommand,
  decision: S.Union([EventFramed, EventSuppressed]),
  error: S.Never,
  decide: decideFrame,
})
