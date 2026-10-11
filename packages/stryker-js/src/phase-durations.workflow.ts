import { Workflow } from '@systemfsoftware/effect-cell-types'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  CheckerBusyIntervalSchema,
  checkerBusyMsOf,
  type PhaseMark,
  PhaseMarkSchema,
} from './phase-durations.schema.js'

export class PhaseDurationsCommand extends S.TaggedClass<PhaseDurationsCommand>()('PhaseDurationsCommand', {
  marks: S.Array(PhaseMarkSchema),
  elapsedMs: Report.NonNegativeFinite,
  checkerBusy: S.Array(CheckerBusyIntervalSchema),
  checkersConfigured: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    elapsedMs: 'stryker.phase_durations.elapsed_ms',
    checkersConfigured: 'stryker.phase_durations.checkers_configured',
  } as const
}

const PhaseDurationsDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/PhaseDurationsDecision')
type PhaseDurationsDecisionTypeId = typeof PhaseDurationsDecisionTypeId

export class PhaseDurationsComputed extends S.TaggedClass<PhaseDurationsComputed>()('PhaseDurationsComputed', {
  durations: RunEvent.PhaseDurations,
}) {
  readonly [PhaseDurationsDecisionTypeId] = PhaseDurationsDecisionTypeId
}

export class PhaseMarksMissing extends S.TaggedClass<PhaseMarksMissing>()('PhaseMarksMissing', {
  phases: S.Array(RunEvent.RunPhase),
}) {
  readonly [PhaseDurationsDecisionTypeId] = PhaseDurationsDecisionTypeId
}

export const PhaseDurationsDecisionSchema = S.Union([PhaseDurationsComputed, PhaseMarksMissing])
export type PhaseDurationsDecision = typeof PhaseDurationsDecisionSchema.Type

const BOUNDARY_PHASES: ReadonlyArray<RunEvent.RunPhase> = ['instrument', 'dry-run', 'mutation-test', 'reporting']

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

const boundariesOf = (command: PhaseDurationsCommand): Option.Option<PhaseBoundaries> =>
  Option.map(
    Option.all({
      instrumentStart: elapsedOf(command.marks, 'instrument'),
      dryRunStart: elapsedOf(command.marks, 'dry-run'),
      mutationTestStart: elapsedOf(command.marks, 'mutation-test'),
      reportingStart: elapsedOf(command.marks, 'reporting'),
    }),
    ({ instrumentStart, dryRunStart, mutationTestStart, reportingStart }): PhaseBoundaries => ({
      prepareStart: 0,
      instrumentStart,
      dryRunStart,
      mutationTestStart,
      reportingStart,
      end: command.elapsedMs,
    }),
  )

const missingPhasesOf = (marks: readonly PhaseMark[]): ReadonlyArray<RunEvent.RunPhase> =>
  Arr.filter(BOUNDARY_PHASES, (phase) => !marks.some((mark) => mark.phase === phase))

const checkDurationOf = (command: PhaseDurationsCommand): RunEvent.CheckDuration =>
  Boolean.match(command.checkersConfigured, {
    onTrue: (): RunEvent.CheckDuration => ({ _tag: 'measured', ms: checkerBusyMsOf(command.checkerBusy) }),
    onFalse: (): RunEvent.CheckDuration => ({ _tag: 'not-run' }),
  })

const durationsOf = (command: PhaseDurationsCommand, boundaries: PhaseBoundaries): RunEvent.PhaseDurations => ({
  prepare: boundaries.instrumentStart - boundaries.prepareStart,
  instrument: boundaries.dryRunStart - boundaries.instrumentStart,
  'dry-run': boundaries.mutationTestStart - boundaries.dryRunStart,
  'mutation-test': boundaries.reportingStart - boundaries.mutationTestStart,
  reporting: { _tag: 'measured', ms: boundaries.end - boundaries.reportingStart },
  check: checkDurationOf(command),
})

const decide = (command: PhaseDurationsCommand): PhaseDurationsDecision =>
  Option.match(boundariesOf(command), {
    onNone: () => PhaseMarksMissing.make({ phases: missingPhasesOf(command.marks) }),
    onSome: (boundaries) => PhaseDurationsComputed.make({ durations: durationsOf(command, boundaries) }),
  })

export const phaseDurations = Workflow.make({
  command: PhaseDurationsCommand,
  decision: PhaseDurationsDecisionSchema,
  error: S.Never,
  decide: (command): Result.Result<PhaseDurationsDecision, never> => Result.succeed(decide(command)),
})
