import { describe, it } from '@systemfsoftware/effect-gherkin-spec'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { FastCheck as fc } from 'effect/testing'

import {
  EventFramed,
  EventSuppressed,
  frameRunEvent,
  FrameRunEventCommand,
  FramingState,
} from '../frame-run-event.workflow.js'
import {
  Heartbeat,
  HelpRendered,
  PhaseEntered,
  PlanKnown,
  RunFailed,
  RunMutantTested,
  RunStarted,
} from '../RunEvent.schema.js'

const FrameRunEventTypeId = Symbol.for(
  '@systemfsoftware/stryker-js/FrameRunEventDecision',
)

const arbitraryTerminalEvent = fc.constantFrom(
  RunFailed.make({
    schemaVersion: '1.0',
    code: 3,
    error: 'fail',
    remediation: 'retry',
  }),
  HelpRendered.make({
    schemaVersion: '1.0',
    code: 0,
    help: 'help text',
  }),
)

const arbitraryNonTerminalEvent = fc.constantFrom(
  RunStarted.make({
    schemaVersion: '1.0',
    runId: 'r',
    mode: 'machine',
    signal: 'tty',
  }),
  PhaseEntered.make({
    phase: 'dry-run',
    elapsedMs: 120,
  }),
  PlanKnown.make({ total: 10 }),
  Heartbeat.make({
    elapsedMs: 500,
    completed: 2,
    total: 10,
  }),
)

const arbitraryState = fc.record({
  mode: fc.constantFrom<'machine' | 'human'>('machine', 'human'),
  signal: fc.constantFrom<'flag' | 'env' | 'tty' | 'agent' | 'tool'>('flag', 'env', 'tty', 'agent', 'tool'),
  headerWritten: fc.boolean(),
  terminalSeen: fc.boolean(),
  completed: fc.nat(),
  total: fc.option(fc.nat(), { nil: null }),
})

describe('frameRunEvent', () => {
  it.prop(
    '∀c_Command_∈Decision',
    [arbitraryState, fc.oneof(arbitraryTerminalEvent, arbitraryNonTerminalEvent)],
    ([state, event]) => {
      const result = frameRunEvent(FrameRunEventCommand.make({ state, event }))
      if (!Result.isSuccess(result)) {
        return false
      }
      return Object.getOwnPropertySymbols(result.success).includes(FrameRunEventTypeId)
    },
  )

  it.prop(
    '∀e_Terminal_≡Suppressed',
    [arbitraryState, arbitraryTerminalEvent, fc.oneof(arbitraryTerminalEvent, arbitraryNonTerminalEvent)],
    ([state, terminalEvent, nextEvent]) => {
      const firstResult = frameRunEvent(
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
      const secondResult = frameRunEvent(
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
    [arbitraryState, arbitraryNonTerminalEvent],
    ([state, event]) => {
      const openMachineState: FramingState = {
        ...state,
        mode: 'machine',
        terminalSeen: false,
        headerWritten: true,
      }
      const result = frameRunEvent(
        FrameRunEventCommand.make({ state: openMachineState, event }),
      )
      return (
        Result.isSuccess(result) &&
        S.is(EventFramed)(result.success) &&
        result.success.event === event
      )
    },
  )

  it.prop(
    '∀e_Human_≡Suppressed',
    [arbitraryState, fc.oneof(arbitraryTerminalEvent, arbitraryNonTerminalEvent)],
    ([state, event]) => {
      const humanState: FramingState = {
        ...state,
        mode: 'human',
      }
      const result = frameRunEvent(
        FrameRunEventCommand.make({ state: humanState, event }),
      )
      return Result.isSuccess(result) && S.is(EventSuppressed)(result.success)
    },
  )

  it.prop(
    '∀m_Mutant_≡Progress',
    [arbitraryState, fc.nat(), fc.nat()],
    ([state, completed, total]) => {
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
      const result = frameRunEvent(
        FrameRunEventCommand.make({ state, event: mutantEvent }),
      )
      return (
        Result.isSuccess(result) &&
        result.success.state.completed === completed &&
        result.success.state.total === total
      )
    },
  )
})
