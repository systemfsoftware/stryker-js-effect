import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import {
  EventFramed,
  EventSuppressed,
  frameRunEvent,
  FrameRunEventCommand,
  FramingState,
} from '../frame-run-event.workflow.js'

const arbitraryTerminalEvent = Arbitrary.schema(
  S.Union([RunEvent.VerdictReached, RunEvent.RunFailed, RunEvent.HelpRendered, RunEvent.Refused]),
)

const arbitraryNonTerminalEvent = Arbitrary.schema(
  S.Union([
    RunEvent.RunStarted,
    RunEvent.PhaseEntered,
    RunEvent.PlanKnown,
    RunEvent.RunMutantTested,
    RunEvent.Heartbeat,
    RunEvent.PluginsReported,
    RunEvent.FormatRegistryResolved,
    RunEvent.SkippedReported,
  ]),
)

const arbitraryEvent = Arbitrary.schema(RunEvent.RunEvent)

const arbitraryState = Arbitrary.schema(FramingState)

const isTerminal = (event: RunEvent.RunEvent): boolean =>
  Match.value(event).pipe(
    Match.tag('verdict', 'error', 'help', 'refused', () => true),
    Match.orElse(() => false),
  )

const expectedNextState = (state: FramingState, event: RunEvent.RunEvent): FramingState =>
  Match.value(event).pipe(
    Match.tag('mutantTested', (tested) => ({ ...state, completed: tested.completed, total: tested.total })),
    Match.tag('plan', (plan) => ({ ...state, total: plan.total })),
    Match.orElse(() => ({ ...state, terminalSeen: state.terminalSeen || isTerminal(event) })),
  )

const sameState = (left: FramingState, right: FramingState): boolean =>
  left.mode === right.mode && left.signal === right.signal && left.headerWritten === right.headerWritten &&
  left.terminalSeen === right.terminalSeen && left.completed === right.completed && left.total === right.total

describe('frameRunEvent', () => {
  it.prop(
    '∀e_Terminal_≡Suppressed',
    { of: [arbitraryState, arbitraryTerminalEvent, arbitraryEvent], subject: frameRunEvent },
    (subject, [state, terminalEvent, nextEvent]) => {
      const firstResult = subject(
        FrameRunEventCommand.make({
          state: { ...state, terminalSeen: false },
          event: terminalEvent,
        }),
      )
      if (!Result.isSuccess(firstResult)) {
        return false
      }
      const nextState = firstResult.success.state
      if (!nextState.terminalSeen) {
        return false
      }
      const secondResult = subject(
        FrameRunEventCommand.make({
          state: nextState,
          event: nextEvent,
        }),
      )
      return Result.isSuccess(secondResult) && S.is(EventSuppressed)(secondResult.success)
    },
  )

  it.prop(
    '∀e_NonTerminal_≡FramedWhateverTheMode',
    { of: [arbitraryState, arbitraryNonTerminalEvent], subject: frameRunEvent },
    (subject, [state, event]) => {
      const openState: FramingState = {
        ...state,
        terminalSeen: false,
        headerWritten: true,
      }
      const result = subject(FrameRunEventCommand.make({ state: openState, event }))
      return Result.isSuccess(result) && S.is(EventFramed)(result.success) && result.success.event === event
    },
  )

  it.prop(
    '∀m_Mutant_≡Progress',
    { of: [arbitraryState, Arbitrary.schema(RunEvent.RunMutantTested)], subject: frameRunEvent },
    (subject, [state, mutantEvent]) => {
      const result = subject(FrameRunEventCommand.make({ state, event: mutantEvent }))
      return (
        Result.isSuccess(result) &&
        result.success.state.completed === mutantEvent.completed &&
        result.success.state.total === mutantEvent.total
      )
    },
  )

  it.prop(
    '∀c_Command_≡FramedExactlyUntilATerminalEventIsSeen',
    { of: [arbitraryState, arbitraryEvent], subject: frameRunEvent },
    (subject, [state, event]) => {
      const result = subject(FrameRunEventCommand.make({ state, event }))
      if (!Result.isSuccess(result)) {
        return false
      }
      const decision = result.success
      return state.terminalSeen
        ? S.is(EventSuppressed)(decision)
        : S.is(EventFramed)(decision) && decision.event === event
    },
  )

  it.prop(
    '∀c_Command_≡NextStateFollowsTheEvent',
    { of: [arbitraryState, arbitraryEvent], subject: frameRunEvent },
    (subject, [state, event]) => {
      const result = subject(FrameRunEventCommand.make({ state, event }))
      return Result.isSuccess(result) && sameState(result.success.state, expectedNextState(state, event))
    },
  )
})
