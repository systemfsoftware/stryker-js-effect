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
  RunFailed,
  RunMutantTested,
  RunStarted,
  SkippedReported,
} from '../run-event.schema.js'

const arbitraryTerminalEvent = Arbitrary.schema(S.Union([RunFailed, HelpRendered]))

const arbitraryNonTerminalEvent = Arbitrary.schema(
  S.Union([RunStarted, PhaseEntered, PlanKnown, Heartbeat, PluginsReported, FormatRegistryResolved, SkippedReported]),
)

const arbitraryEvent = Arbitrary.schema(
  S.Union([
    RunFailed,
    HelpRendered,
    RunStarted,
    PhaseEntered,
    PlanKnown,
    Heartbeat,
    PluginsReported,
    FormatRegistryResolved,
    SkippedReported,
  ]),
)

const arbitraryState = Arbitrary.schema(FramingState)

const arbitraryNat = Arbitrary.schema(S.Int.check(S.isGreaterThanOrEqualTo(0)))

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
    '∀e_MachineOpen_≡Framed',
    { of: [arbitraryState, arbitraryNonTerminalEvent], subject: frameRunEvent },
    (subject, [state, event]) => {
      const openMachineState: FramingState = {
        ...state,
        mode: 'machine',
        terminalSeen: false,
        headerWritten: true,
      }
      const result = subject(FrameRunEventCommand.make({ state: openMachineState, event }))
      return Result.isSuccess(result) && S.is(EventFramed)(result.success) && result.success.event === event
    },
  )

  it.prop(
    '∀e_Human_≡Suppressed',
    { of: [arbitraryState, arbitraryEvent], subject: frameRunEvent },
    (subject, [state, event]) => {
      const humanState: FramingState = {
        ...state,
        mode: 'human',
      }
      const result = subject(FrameRunEventCommand.make({ state: humanState, event }))
      return Result.isSuccess(result) && S.is(EventSuppressed)(result.success)
    },
  )

  it.prop(
    '∀m_Mutant_≡Progress',
    { of: [arbitraryState, arbitraryNat, arbitraryNat], subject: frameRunEvent },
    (subject, [state, completed, total]) => {
      const mutantEvent = RunMutantTested.make({
        id: '1',
        file: 'src/foo.ts',
        status: 'Killed',
        location: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
        mutator: 'EqualityOperator',
        replacement: '!=',
        completed,
        total,
      })
      const result = subject(FrameRunEventCommand.make({ state, event: mutantEvent }))
      return (
        Result.isSuccess(result) &&
        result.success.state.completed === completed &&
        result.success.state.total === total
      )
    },
  )
})
