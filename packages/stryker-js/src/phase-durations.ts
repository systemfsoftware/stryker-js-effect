import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import { CheckerBusyIntervalSchema } from './phase-durations.schema.js'

export type CheckerBusyInterval = typeof CheckerBusyIntervalSchema.Type

export interface PhaseMark {
  readonly phase: RunEvent.RunPhase
  readonly elapsedMs: number
}

export interface PhaseDurationsInput {
  readonly marks: readonly PhaseMark[]
  readonly elapsedMs: number
  readonly checkerBusy: readonly CheckerBusyInterval[]
  readonly checkersConfigured: boolean
}

interface PhaseBoundaries {
  readonly prepareStart: number
  readonly instrumentStart: number
  readonly dryRunStart: number
  readonly mutationTestStart: number
  readonly reportingStart: number
  readonly end: number
}

const elapsedOf = (marks: readonly PhaseMark[], phase: RunEvent.RunPhase): Option.Option<number> =>
  Option.map(Arr.findFirst(marks, (mark) => mark.phase === phase), (mark) => mark.elapsedMs)

const boundariesOf = (input: PhaseDurationsInput): Option.Option<PhaseBoundaries> =>
  Option.map(
    Option.all({
      instrumentStart: elapsedOf(input.marks, 'instrument'),
      dryRunStart: elapsedOf(input.marks, 'dry-run'),
      mutationTestStart: elapsedOf(input.marks, 'mutation-test'),
      reportingStart: elapsedOf(input.marks, 'reporting'),
    }),
    ({ instrumentStart, dryRunStart, mutationTestStart, reportingStart }): PhaseBoundaries => ({
      prepareStart: 0,
      instrumentStart,
      dryRunStart,
      mutationTestStart,
      reportingStart,
      end: input.elapsedMs,
    }),
  )

const checkDurationOf = (
  checkerBusy: readonly CheckerBusyInterval[],
  checkersConfigured: boolean,
): RunEvent.CheckDuration =>
  checkersConfigured ? { _tag: 'measured', ms: checkerBusyMsOf(checkerBusy) } : { _tag: 'not-run' }

export const checkerBusyMsOf = (intervals: readonly CheckerBusyInterval[]): number =>
  intervals
    .map((interval) => ({ startMs: interval.startMs, endMs: Math.max(interval.startMs, interval.endMs) }))
    .sort((left, right) => left.startMs - right.startMs)
    .reduce(
      ({ busyMs, reach }, span) => ({
        busyMs: busyMs + Math.max(0, span.endMs - Math.max(span.startMs, reach)),
        reach: Math.max(reach, span.endMs),
      }),
      { busyMs: 0, reach: Number.NEGATIVE_INFINITY },
    ).busyMs

export const phaseDurationsOf = (input: PhaseDurationsInput): Option.Option<RunEvent.PhaseDurations> =>
  Option.map(
    boundariesOf(input),
    (boundaries): RunEvent.PhaseDurations => ({
      prepare: boundaries.instrumentStart - boundaries.prepareStart,
      instrument: boundaries.dryRunStart - boundaries.instrumentStart,
      'dry-run': boundaries.mutationTestStart - boundaries.dryRunStart,
      'mutation-test': boundaries.reportingStart - boundaries.mutationTestStart,
      reporting: { _tag: 'measured', ms: boundaries.end - boundaries.reportingStart },
      check: checkDurationOf(input.checkerBusy, input.checkersConfigured),
    }),
  )
