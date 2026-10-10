import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { EventSuppressed, frameRunEvent, FrameRunEventCommand, FramingState } from '../frame-run-event.workflow.js'

const arbitraryTerminalEvent = Arbitrary.schema(
  S.Union([RunEvent.VerdictReached, RunEvent.RunFailed, RunEvent.HelpRendered, RunEvent.Refused]),
)

const arbitraryEvent = Arbitrary.schema(RunEvent.RunEvent)

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
})
