import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ProgressReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ProgressReport')
type ProgressReportTypeId = typeof ProgressReportTypeId

const ProgressTimingSchema = S.Struct({ net: S.Finite, overhead: S.Finite })

const ProgressCapabilitiesSchema = S.Struct({ reloadEnvironment: S.Boolean })

export const ProgressTallySchema = S.Struct({
  survived: S.Finite,
  timedOut: S.Finite,
  tested: S.Finite,
  mutants: S.Finite,
  total: S.Finite,
  ticks: S.Finite,
  ticksByMutantId: S.Record(S.String, S.Finite),
  timing: ProgressTimingSchema,
  capabilities: ProgressCapabilitiesSchema,
  startedAt: S.Finite,
})
export type ProgressTally = typeof ProgressTallySchema.Type

export const ProgressBarStateSchema = S.Struct({
  format: S.String,
  total: S.Finite,
  curr: S.Finite,
  width: S.Finite,
  complete: S.String,
  incomplete: S.String,
})
export type ProgressBarState = typeof ProgressBarStateSchema.Type

export const ProgressStateSchema = S.Struct({
  tally: ProgressTallySchema,
  bar: S.NullOr(ProgressBarStateSchema),
})
export type ProgressState = typeof ProgressStateSchema.Type

export class ProgressReportCommand extends S.TaggedClass<ProgressReportCommand>()('ProgressReportCommand', {
  kind: S.Literals(['tick', 'skip', 'finalize']),
  state: ProgressStateSchema,
  now: S.Finite,
}) {
  static readonly [Workflow.InstrumentationBrand] = { now: 'stryker.report.rendered' } as const
}

export class ProgressBarTick extends S.TaggedClass<ProgressBarTick>()('ProgressBarTick', {
  bar: ProgressBarStateSchema,
  tally: ProgressTallySchema,
  now: S.Finite,
}) {
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

export class ProgressLineBreak extends S.TaggedClass<ProgressLineBreak>()('ProgressLineBreak', {}) {
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

export class ProgressChunkSuppressed extends S.TaggedClass<ProgressChunkSuppressed>()('ProgressChunkSuppressed', {}) {
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

export const ProgressReportDecision = S.Union([ProgressBarTick, ProgressLineBreak, ProgressChunkSuppressed])
export type ProgressReportDecision = typeof ProgressReportDecision.Type

const isComplete = (bar: ProgressBarState): boolean => bar.curr >= bar.total

export const renderProgressReport = Workflow.make({
  command: ProgressReportCommand,
  decision: ProgressReportDecision,
  error: S.Never,
  decide: (command) =>
    Result.succeed(
      Match.value(command.kind).pipe(
        Match.when('finalize', () =>
          Option.match(Option.fromNullishOr(command.state.bar), {
            onNone: () => ProgressChunkSuppressed.make({}),
            onSome: (bar) =>
              Boolean.match(isComplete(bar), {
                onTrue: () => ProgressChunkSuppressed.make({}),
                onFalse: () => ProgressLineBreak.make({}),
              }),
          })),
        Match.when('skip', () => ProgressChunkSuppressed.make({})),
        Match.when('tick', () =>
          Option.match(Option.fromNullishOr(command.state.bar), {
            onNone: () => ProgressChunkSuppressed.make({}),
            onSome: (bar) => ProgressBarTick.make({ bar, tally: command.state.tally, now: command.now }),
          })),
        Match.exhaustive,
      ),
    ),
})
