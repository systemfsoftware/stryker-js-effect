import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type CheckerBusyInterval,
  CheckerBusyIntervalSchema,
  checkerBusyMsOf,
  type PhaseMark,
} from '../phase-durations.schema.js'
import { phaseDurations, PhaseDurationsCommand, type PhaseDurationsDecision } from '../phase-durations.workflow.js'

const CANONICAL_PHASES: ReadonlyArray<RunEvent.RunPhase> = [
  'prepare',
  'instrument',
  'dry-run',
  'mutation-test',
  'reporting',
]

const BOUNDARY_PHASES: ReadonlyArray<RunEvent.RunPhase> = ['instrument', 'dry-run', 'mutation-test', 'reporting']

const PHASE_WINDOW_MS = 3_600_000

type PhaseIncrements = readonly [number, number, number, number, number]

const scaledMsOf = (magnitude: number): number => (magnitude / (1 + magnitude)) * PHASE_WINDOW_MS

const marksOf = (
  entered: ReadonlyArray<RunEvent.RunPhase>,
  gaps: ReadonlyArray<number>,
): ReadonlyArray<PhaseMark> => {
  let elapsedMs = 0
  return CANONICAL_PHASES.filter((phase) => entered.includes(phase)).map((phase, index) => {
    elapsedMs += scaledMsOf(gaps[index] ?? 0)
    return { phase, elapsedMs }
  })
}

const boundedMarksOf = (increments: PhaseIncrements): ReadonlyArray<PhaseMark> => {
  let elapsedMs = 0
  return CANONICAL_PHASES.map((phase, index) => {
    elapsedMs += scaledMsOf(increments[index] ?? 0)
    return { phase, elapsedMs }
  })
}

const commandOf = (
  marks: readonly PhaseMark[],
  elapsedMs: number,
  checkerBusy: readonly CheckerBusyInterval[],
  checkersConfigured: boolean,
): PhaseDurationsCommand => PhaseDurationsCommand.make({ marks, elapsedMs, checkerBusy, checkersConfigured })

const decisionOf = (result: Result.Result<PhaseDurationsDecision, never>): PhaseDurationsDecision =>
  Result.getOrElse(result, (never: never) => never)

const reportingMsOf = (durations: RunEvent.PhaseDurations): number =>
  Match.value(durations.reporting).pipe(
    Match.tag('measured', (measured) => measured.ms),
    Match.orElse(() => 0),
  )

const totalOf = (durations: RunEvent.PhaseDurations): number =>
  durations.prepare +
  durations.instrument +
  durations['dry-run'] +
  durations['mutation-test'] +
  reportingMsOf(durations)

const withinEpsilon = (actual: number, expected: number, magnitude: number): boolean =>
  Math.abs(actual - expected) <= Number.EPSILON * 16 * Math.max(1, magnitude)

describe('phaseDurations', () => {
  it.prop(
    '∀m_PhaseMarks_≡ThePhaseDurationsAddUpToTheElapsedTime',
    {
      of: [S.Array(RunEvent.RunPhase), S.Array(Report.NonNegativeFinite), Report.NonNegativeFinite],
      subject: phaseDurations,
    },
    (subject, [entered, gaps, tail]) => {
      const marks = marksOf(entered, gaps)
      const elapsedMs = (marks.at(-1)?.elapsedMs ?? 0) + scaledMsOf(tail)
      const neverEntered = BOUNDARY_PHASES.filter((phase) => !entered.includes(phase))
      return Match.valueTags(decisionOf(subject(commandOf(marks, elapsedMs, [], false))), {
        PhaseDurationsComputed: ({ durations }) =>
          neverEntered.length === 0 &&
          withinEpsilon(totalOf(durations), elapsedMs, elapsedMs) &&
          durations.prepare >= 0 &&
          durations.instrument >= 0 &&
          durations['dry-run'] >= 0 &&
          durations['mutation-test'] >= 0,
        PhaseMarksMissing: ({ phases }) =>
          neverEntered.length > 0 &&
          phases.length === neverEntered.length &&
          phases.every((phase) => neverEntered.includes(phase)),
      })
    },
  )

  it.prop(
    '∀configured_PhaseDurationsCheckAndReporting_≡MeasuredOrNotRun',
    {
      of: [
        S.Tuple([
          Report.NonNegativeFinite,
          Report.NonNegativeFinite,
          Report.NonNegativeFinite,
          Report.NonNegativeFinite,
          Report.NonNegativeFinite,
        ]),
        S.Array(CheckerBusyIntervalSchema),
        S.Boolean,
        Report.NonNegativeFinite,
      ],
      subject: phaseDurations,
    },
    (subject, [increments, intervals, checkersConfigured, tail]) => {
      const marks = boundedMarksOf(increments)
      const elapsedMs = (marks.at(-1)?.elapsedMs ?? 0) + scaledMsOf(tail)
      const decision = decisionOf(subject(commandOf(marks, elapsedMs, intervals, checkersConfigured)))
      return Option.match(
        Match.valueTags(decision, {
          PhaseDurationsComputed: ({ durations }) => Option.some(durations),
          PhaseMarksMissing: () => Option.none<RunEvent.PhaseDurations>(),
        }),
        {
          onNone: () => false,
          onSome: (durations) =>
            withinEpsilon(totalOf(durations), elapsedMs, elapsedMs) &&
            Match.value(durations.reporting).pipe(
              Match.tag('measured', (measured) => withinEpsilon(measured.ms, scaledMsOf(tail), elapsedMs)),
              Match.orElse(() => false),
            ) &&
            Match.value(durations.check).pipe(
              Match.tag('measured', (measured) => checkersConfigured && measured.ms === checkerBusyMsOf(intervals)),
              Match.tag('not-run', () => !checkersConfigured),
              Match.orElse(() => false),
            ),
        },
      )
    },
  )
})
