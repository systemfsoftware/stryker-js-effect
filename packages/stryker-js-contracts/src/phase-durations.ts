import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

export interface PhaseMark {
  readonly phase: RunEvent.RunPhase
  readonly elapsedMs: number
}

export interface PhaseDurationsInput {
  readonly marks: readonly PhaseMark[]
  readonly elapsedMs: number
}

interface PhaseBoundaries {
  readonly prepareStart: number
  readonly instrumentStart: number
  readonly dryRunStart: number
  readonly mutationTestStart: number
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
    }),
    ({ instrumentStart, dryRunStart, mutationTestStart }): PhaseBoundaries => ({
      prepareStart: 0,
      instrumentStart,
      dryRunStart,
      mutationTestStart,
      end: input.elapsedMs,
    }),
  )

export const phaseDurationsOf = (input: PhaseDurationsInput): Option.Option<RunEvent.PhaseDurations> =>
  Option.map(
    boundariesOf(input),
    (boundaries): RunEvent.PhaseDurations => ({
      prepare: boundaries.instrumentStart - boundaries.prepareStart,
      instrument: boundaries.dryRunStart - boundaries.instrumentStart,
      'dry-run': boundaries.mutationTestStart - boundaries.dryRunStart,
      'mutation-test': boundaries.end - boundaries.mutationTestStart,
    }),
  )
