import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  EventFramed,
  EventSuppressed,
  frameRunEvent,
  FrameRunEventCommand,
  FramingState,
} from '../frame-run-event.workflow.js'
import {
  FormatRegistryResolved,
  Heartbeat,
  HelpRendered,
  PhaseEntered,
  PlanKnown,
  PluginsReported,
  RunEvent,
  RunFailed,
  RunMutantTested,
  RunStarted,
  SkippedReported,
  VerdictReached,
} from '../run-event.schema.js'

const arbitraryTerminalEvent = Arbitrary.schema(S.Union([VerdictReached, RunFailed, HelpRendered]))

const arbitraryNonTerminalEvent = Arbitrary.schema(
  S.Union([
    RunStarted,
    PhaseEntered,
    PlanKnown,
    RunMutantTested,
    Heartbeat,
    PluginsReported,
    FormatRegistryResolved,
    SkippedReported,
  ]),
)

const arbitraryEvent = Arbitrary.schema(RunEvent)

const arbitraryState = Arbitrary.schema(FramingState)

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
    { of: [arbitraryState, Arbitrary.schema(RunMutantTested)], subject: frameRunEvent },
    (subject, [state, mutantEvent]) => {
      const result = subject(FrameRunEventCommand.make({ state, event: mutantEvent }))
      return (
        Result.isSuccess(result) &&
        result.success.state.completed === mutantEvent.completed &&
        result.success.state.total === mutantEvent.total
      )
    },
  )
})
