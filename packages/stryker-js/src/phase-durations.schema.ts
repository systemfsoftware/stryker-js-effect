import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const PhaseMarkSchema = S.Struct({
  phase: RunEvent.RunPhase,
  elapsedMs: Report.NonNegativeFinite,
})
export type PhaseMark = typeof PhaseMarkSchema.Type

export const CheckerBusyReadingSchema = S.Struct({
  startMs: Report.NonNegativeFinite,
  endMs: Report.NonNegativeFinite,
})
export type CheckerBusyReading = typeof CheckerBusyReadingSchema.Type

export const CheckerBusyIntervalSchema = CheckerBusyReadingSchema.check(
  S.makeFilter(
    (reading: CheckerBusyReading) => reading.endMs >= reading.startMs,
    { expected: 'a checker-busy interval whose end does not precede its start' },
  ),
)
export type CheckerBusyInterval = typeof CheckerBusyIntervalSchema.Type

export const checkerBusyIntervalOf = (reading: CheckerBusyReading): CheckerBusyInterval => ({
  startMs: reading.startMs,
  endMs: Math.max(reading.startMs, reading.endMs),
})

export const checkerBusyMsOf = (intervals: readonly CheckerBusyInterval[]): number =>
  [...intervals]
    .sort((left, right) => left.startMs - right.startMs)
    .reduce(
      ({ busyMs, reach }, span) => ({
        busyMs: busyMs + Math.max(0, span.endMs - Math.max(span.startMs, reach)),
        reach: Math.max(reach, span.endMs),
      }),
      { busyMs: 0, reach: Number.NEGATIVE_INFINITY },
    ).busyMs

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const holds = (conditions: readonly boolean[]): boolean => conditions.every((condition) => condition)

  const isBusyReading = (reading: CheckerBusyReading): boolean =>
    holds([reading.startMs >= 0, reading.endMs >= 0, reading.endMs >= reading.startMs])

  const orderedEndOf = (reading: CheckerBusyReading, interval: CheckerBusyInterval): boolean =>
    reading.endMs >= reading.startMs ? interval.endMs === reading.endMs : interval.endMs === reading.startMs

  const acceptedByTheSchema = S.is(CheckerBusyIntervalSchema)

  const BOUNDARY_MS = [-1, 0, 1, Number.MAX_SAFE_INTEGER]
  const withBoundaryMs = (drawn: number): ReadonlyArray<number> => [...BOUNDARY_MS, drawn]

  const SPAN_WINDOW_MS = 3_600_000
  const scaledMsOf = (magnitude: number): number => (magnitude / (1 + magnitude)) * SPAN_WINDOW_MS

  const laidOutOf = (segments: ReadonlyArray<readonly [number, number]>): ReadonlyArray<CheckerBusyInterval> => {
    let cursor = 0
    return segments.map(([gap, length]) => {
      const startMs = cursor + scaledMsOf(gap)
      cursor = startMs + scaledMsOf(length)
      return { startMs, endMs: cursor }
    })
  }

  it.prop(
    '∀r_CheckerBusyReading_≡RefusedExactlyWhenAReadingIsNegativeOrItsEndPrecedesItsStart',
    { of: [S.Tuple([S.Int, S.Int])], subject: acceptedByTheSchema },
    (subject, [[drawnStart, drawnEnd]]) =>
      Arr.every(
        withBoundaryMs(drawnStart),
        (startMs) =>
          Arr.every(withBoundaryMs(drawnEnd), (endMs) =>
            subject({ startMs, endMs }) === isBusyReading({ startMs, endMs })),
      ),
  )

  it.prop(
    '∀r_CheckerBusyReading_≡ClampedToTheLaterReadingAndAccepted',
    { of: [CheckerBusyReadingSchema], subject: checkerBusyIntervalOf },
    (subject, [reading]) => {
      const interval = subject(reading)
      return holds([
        acceptedByTheSchema(interval),
        interval.startMs === reading.startMs,
        orderedEndOf(reading, interval),
      ])
    },
  )

  it.prop(
    '∀intervals_CheckerBusyMs_⊆LongestAndSum',
    { of: [S.Array(CheckerBusyIntervalSchema)], subject: checkerBusyMsOf },
    (subject, [intervals]) => {
      const spans = intervals.map((interval) => interval.endMs - interval.startMs)
      const longest = Math.max(0, ...spans)
      const sum = spans.reduce((total, span) => total + span, 0)
      const busyMs = subject(intervals)
      return holds([busyMs >= longest, busyMs <= sum])
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
      const cut = first.startMs + (first.endMs - first.startMs) * (rawCut / (1 + rawCut))
      return subject(intervals) ===
        subject([{ startMs: first.startMs, endMs: cut }, { startMs: cut, endMs: first.endMs }, ...intervals.slice(1)])
    },
  )

  it.prop(
    '∀intervals_CheckerBusyMs_≡Duplicated',
    { of: [S.Array(CheckerBusyIntervalSchema)], subject: checkerBusyMsOf },
    (subject, [intervals]) => subject(intervals) === subject([...intervals, ...intervals]),
  )
}
