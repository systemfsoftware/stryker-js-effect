import { Workflow } from '@systemfsoftware/effect-cell-types'
import { OutputMode, RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const FrameRunEventTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/FrameRunEventDecision',
)
type FrameRunEventTypeId = typeof FrameRunEventTypeId

export const FramingState = S.Struct({
  mode: OutputMode.OutputMode,
  signal: OutputMode.ModeSignal,
  headerWritten: S.Boolean,
  terminalSeen: S.Boolean,
  completed: Report.NonNegativeInt,
  total: S.NullOr(Report.NonNegativeInt),
})
export type FramingState = typeof FramingState.Type

export class FrameRunEventCommand extends S.TaggedClass<FrameRunEventCommand, { readonly brand: unique symbol }>()(
  'FrameRunEventCommand',
  {
    state: FramingState,
    event: RunEvent.RunEvent,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class EventFramed extends S.TaggedClass<EventFramed, { readonly brand: unique symbol }>()('EventFramed', {
  state: FramingState,
  event: RunEvent.RunEvent,
}) {
  readonly [FrameRunEventTypeId] = FrameRunEventTypeId
}

export class EventSuppressed extends S.TaggedClass<EventSuppressed, { readonly brand: unique symbol }>()(
  'EventSuppressed',
  {
    state: FramingState,
  },
) {
  readonly [FrameRunEventTypeId] = FrameRunEventTypeId
}

export type FrameRunEventDecision = EventFramed | EventSuppressed

export const ResolvedModeInput = S.Struct({
  mode: OutputMode.OutputMode,
  signal: OutputMode.ModeSignal,
})
export type ResolvedModeInput = typeof ResolvedModeInput.Type

const nextFramingState = (state: FramingState, event: RunEvent.RunEvent): FramingState =>
  Match.value(event).pipe(
    Match.tag('verdict', 'error', 'help', 'refused', () =>
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
    Match.tag('worker', () => state),
    Match.tag('plugins', () => state),
    Match.tag('formats', () => state),
    Match.tag('skipped', () => state),
    Match.tag('reuse', 'tce', 'mutant-detail', 'feedback', () => state),
    Match.exhaustive,
  )

const noteState = (state: FramingState, event: RunEvent.RunEvent): FramingState => nextFramingState(state, event)

const shouldFrame = (state: FramingState): boolean => !state.terminalSeen

const decideFrame = (
  command: FrameRunEventCommand,
): Result.Result<FrameRunEventDecision, never> => {
  const nextState = noteState(command.state, command.event)
  const framed = shouldFrame(command.state)

  return Match.value(framed).pipe(
    Match.when(true, () =>
      Result.succeed(
        EventFramed.make({
          state: nextState,
          event: command.event,
        }),
      )),
    Match.when(false, () =>
      Result.succeed(
        EventSuppressed.make({
          state: nextState,
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
