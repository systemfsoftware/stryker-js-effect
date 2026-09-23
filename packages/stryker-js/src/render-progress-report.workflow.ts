import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ProgressReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ProgressReport')
type ProgressReportTypeId = typeof ProgressReportTypeId

const ProgressTimingSchema = S.Struct({ net: S.Number, overhead: S.Number })

const ProgressCapabilitiesSchema = S.Struct({ reloadEnvironment: S.Boolean })

export const ProgressTallySchema = S.Struct({
  survived: S.Number,
  timedOut: S.Number,
  tested: S.Number,
  mutants: S.Number,
  total: S.Number,
  ticks: S.Number,
  ticksByMutantId: S.Record(S.String, S.Number),
  timing: ProgressTimingSchema,
  capabilities: ProgressCapabilitiesSchema,
  startedAt: S.Number,
})
export type ProgressTally = typeof ProgressTallySchema.Type

export const ProgressBarStateSchema = S.Struct({
  format: S.String,
  total: S.Number,
  curr: S.Number,
  width: S.Number,
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
  now: S.Number,
}) {
  static readonly [Workflow.InstrumentationBrand] = { now: 'stryker.report.rendered' } as const
}

export class ProgressChunkRendered extends S.TaggedClass<ProgressChunkRendered>()('ProgressChunkRendered', {
  chunk: S.String,
}) {
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

export class ProgressChunkSuppressed extends S.TaggedClass<ProgressChunkSuppressed>()('ProgressChunkSuppressed', {}) {
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

const PROGRESS_BAR_FORMAT =
  'Mutation testing  [:bar] :percent (elapsed: :et, remaining: :etc) :tested/:mutants Mutants tested (:survived survived, :timedOut timed out)'

const PROGRESS_BAR_OPTIONS = { complete: '=', incomplete: ' ', width: 50 }

const isComplete = (state: ProgressBarState) => state.curr >= state.total

const formatBar = (
  format: string,
  curr: number,
  total: number,
  data: Readonly<Record<string, string | number>>,
  options: { readonly width: number; readonly complete: string; readonly incomplete: string },
): string => {
  const ratio = Match.value(total === 0).pipe(
    Match.when(true, () => 0),
    Match.when(false, () => Math.min(curr / total, 1)),
    Match.exhaustive,
  )
  const filled = Math.floor(ratio * options.width)
  const bar = options.complete.repeat(filled) + options.incomplete.repeat(options.width - filled)
  const percent = `${Math.floor(ratio * 100).toString().padStart(3, ' ')}%`
  const printed = format.replace(':bar', bar).replace(':percent', percent)
  return Object.entries(data).reduce((out, [key, value]) => out.replaceAll(`:${key}`, String(value)), printed)
}

const formatTime = (timeInSeconds: number): string => {
  const hours = Math.floor(timeInSeconds / 3600)
  const minutes = Math.floor((timeInSeconds % 3600) / 60)
  return Match.value(hours > 0).pipe(
    Match.when(true, () => `~${hours}h ${minutes}m`),
    Match.when(false, () =>
      Match.value(minutes > 0).pipe(
        Match.when(true, () => `~${minutes}m`),
        Match.when(false, () => '<1m'),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )
}

const getElapsedTime = (tally: ProgressTally, now: number): string =>
  formatTime(Math.floor((now - tally.startedAt) / 1000))

const getEtc = (tally: ProgressTally, now: number): string => {
  const elapsed = Math.floor((now - tally.startedAt) / 1000)
  const remaining = Math.floor((elapsed / tally.ticks) * (tally.total - tally.ticks))
  return Match.value(Number.isFinite(remaining) && remaining > 0).pipe(
    Match.when(true, () => formatTime(remaining)),
    Match.when(false, () => 'n/a'),
    Match.exhaustive,
  )
}

const progressData = (tally: ProgressTally, now: number): Record<string, string | number> => ({
  survived: tally.survived,
  timedOut: tally.timedOut,
  tested: tally.tested,
  mutants: tally.mutants,
  total: tally.total,
  ticks: tally.ticks,
  et: getElapsedTime(tally, now),
  etc: getEtc(tally, now),
})

const renderProgressBar = (state: ProgressBarState, data: Readonly<Record<string, string | number>>) =>
  formatBar(state.format, state.curr, state.total, data, {
    width: state.width,
    complete: state.complete,
    incomplete: state.incomplete,
  })

export const renderProgressReport = Workflow.make({
  command: ProgressReportCommand,
  decision: S.Union([ProgressChunkRendered, ProgressChunkSuppressed]),
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
                onFalse: () => ProgressChunkRendered.make({ chunk: '\n' }),
              }),
          })),
        Match.when('skip', () => ProgressChunkSuppressed.make({})),
        Match.when('tick', () =>
          Option.match(Option.fromNullishOr(command.state.bar), {
            onNone: () => ProgressChunkSuppressed.make({}),
            onSome: (bar) => {
              const line = renderProgressBar(bar, progressData(command.state.tally, command.now))
              const newline = Boolean.match(isComplete(bar), {
                onTrue: () => '\n',
                onFalse: () => '',
              })
              return ProgressChunkRendered.make({ chunk: `\r${line}${newline}` })
            },
          })),
        Match.exhaustive,
      ),
    ),
})
