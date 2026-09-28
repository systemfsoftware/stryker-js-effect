import { Workflow } from '@systemfsoftware/effect-cell-types'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const RecordFeedbackTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/RecordFeedbackDecision')
type RecordFeedbackTypeId = typeof RecordFeedbackTypeId

export class FeedbackRecorded extends S.TaggedClass<FeedbackRecorded>()('FeedbackRecorded', {
  id: Mutant.MutantId,
  judgment: RunEvent.FeedbackJudgment,
  reason: S.NullOr(S.String),
}) {
  readonly [RecordFeedbackTypeId] = RecordFeedbackTypeId
}

export class FeedbackRefused extends S.TaggedClass<FeedbackRefused>()('FeedbackRefused', {
  id: Mutant.MutantId,
}) {
  readonly [RecordFeedbackTypeId] = RecordFeedbackTypeId
}

export const RecordFeedbackDecision = S.Union([FeedbackRecorded, FeedbackRefused])
export type RecordFeedbackDecision = typeof RecordFeedbackDecision.Type

export class RecordFeedbackCommand extends S.Class<RecordFeedbackCommand>('RecordFeedbackCommand')({
  id: Mutant.MutantId,
  judgment: RunEvent.FeedbackJudgment,
  reason: S.NullOr(S.String),
  knownIds: S.Array(Mutant.MutantId),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const recordedOf = (command: RecordFeedbackCommand): FeedbackRecorded =>
  FeedbackRecorded.make({ id: command.id, judgment: command.judgment, reason: command.reason })

const refusedOf = (command: RecordFeedbackCommand): FeedbackRefused => FeedbackRefused.make({ id: command.id })

const decidedOf = (command: RecordFeedbackCommand): RecordFeedbackDecision =>
  Match.value(Arr.contains(command.knownIds, command.id)).pipe(
    Match.when(true, () => recordedOf(command)),
    Match.when(false, () => refusedOf(command)),
    Match.exhaustive,
  )

export const recordFeedback = Workflow.make({
  command: RecordFeedbackCommand,
  decision: RecordFeedbackDecision,
  error: S.Never,
  decide: (command): Result.Result<RecordFeedbackDecision, never> => Result.succeed(decidedOf(command)),
})
