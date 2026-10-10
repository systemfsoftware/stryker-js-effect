import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { type CheckerBusyInterval, checkerBusyMsOf, phaseDurationsOf, type PhaseMark } from '../phase-durations.js'
import { CheckerBusyIntervalSchema } from '../phase-durations.schema.js'

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

const laidOutOf = (segments: ReadonlyArray<readonly [number, number]>): ReadonlyArray<CheckerBusyInterval> => {
  let cursor = 0
  return segments.map(([gap, length]) => {
    const startMs = cursor + scaledMsOf(gap)
    cursor = startMs + scaledMsOf(length)
    return { startMs, endMs: cursor }
  })
}

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

describe('phaseDurationsOf', () => {
  it.prop(
    '∀m_PhaseMarks_≡ThePhaseDurationsAddUpToTheElapsedTime',
    {
      of: [S.Array(RunEvent.RunPhase), S.Array(Report.NonNegativeFinite), Report.NonNegativeFinite],
      subject: phaseDurationsOf,
    },
    (subject, [entered, gaps, tail]) => {
      const marks = marksOf(entered, gaps)
      const elapsedMs = (marks.at(-1)?.elapsedMs ?? 0) + scaledMsOf(tail)
      const boundedEveryPhase = BOUNDARY_PHASES.every((phase) => entered.includes(phase))
      return Option.match(subject({ marks, elapsedMs, checkerBusy: [], checkersConfigured: false }), {
        onNone: () => !boundedEveryPhase,
        onSome: (durations) =>
          boundedEveryPhase &&
          withinEpsilon(totalOf(durations), elapsedMs, elapsedMs) &&
          durations.prepare >= 0 &&
          durations.instrument >= 0 &&
          durations['dry-run'] >= 0 &&
          durations['mutation-test'] >= 0,
      })
    },
  )

  it.prop(
    '∀intervals_CheckerBusyMs_⊆LongestAndSum',
    { of: [S.Array(CheckerBusyIntervalSchema)], subject: checkerBusyMsOf },
    (subject, [intervals]) => {
      const spans = intervals.map((
        interval,
      ) => (interval.endMs > interval.startMs ? interval.endMs - interval.startMs : 0))
      const longest = spans.length === 0 ? 0 : Math.max(...spans)
      const sum = spans.reduce((total, span) => total + span, 0)
      const busyMs = subject(intervals)
      return busyMs >= longest && busyMs <= sum
    },
  )

  it.prop(
    '∀segments_DisjointCheckerBusyMs_≡Sum',
    {
      of: [S.Array(S.Tuple([Report.NonNegativeFinite, Report.NonNegativeFinite]))],
      subject: checkerBusyMsOf,
    },
    (subject, [segments]) => {
      const intervals = laidOutOf(segments)
      return subject(intervals) ===
        intervals.reduce((total, interval) => total + (interval.endMs - interval.startMs), 0)
    },
  )

  it.prop(
    '∀intervals_CheckerBusyMs_≡Reordered',
    { of: [S.Array(CheckerBusyIntervalSchema)], subject: checkerBusyMsOf },
    (subject, [intervals]) => subject(intervals) === subject([...intervals].reverse()),
  )

  it.prop(
    '∀intervals_CheckerBusyMs_≡SplitFirst',
    { of: [S.Array(CheckerBusyIntervalSchema), Report.NonNegativeFinite], subject: checkerBusyMsOf },
    (subject, [intervals, rawCut]) => {
      const first = intervals[0]
      if (first === undefined) {
        return true
      }
      const low = Math.min(first.startMs, first.endMs)
      const high = Math.max(first.startMs, first.endMs)
      const cut = low + (high - low) * (rawCut / (1 + rawCut))
      return subject(intervals) ===
        subject([{ startMs: first.startMs, endMs: cut }, { startMs: cut, endMs: first.endMs }, ...intervals.slice(1)])
    },
  )

  it.prop(
    '∀intervals_CheckerBusyMs_≡Duplicated',
    { of: [S.Array(CheckerBusyIntervalSchema)], subject: checkerBusyMsOf },
    (subject, [intervals]) => subject(intervals) === subject([...intervals, ...intervals]),
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
      subject: phaseDurationsOf,
    },
    (subject, [increments, intervals, checkersConfigured, tail]) => {
      const marks = boundedMarksOf(increments)
      const elapsedMs = (marks.at(-1)?.elapsedMs ?? 0) + scaledMsOf(tail)
      return Option.match(subject({ marks, elapsedMs, checkerBusy: intervals, checkersConfigured }), {
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
      })
    },
  )
})
