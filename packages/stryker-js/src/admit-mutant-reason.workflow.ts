import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const MutantReasonTypeId = Symbol.for('@systemfsoftware/stryker-js/MutantReasonDecision')
type MutantReasonTypeId = typeof MutantReasonTypeId

const StreamableStatus = Mutant.MutantStatusSchema.pick([
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Ignored',
])
type StreamableStatus = typeof StreamableStatus.Type

export class MutantReasonCommand extends S.TaggedClass<MutantReasonCommand>()('MutantReasonCommand', {
  status: Mutant.MutantStatusSchema,
  statusReason: S.UndefinedOr(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ReasonAdmitted extends S.TaggedClass<ReasonAdmitted>()('ReasonAdmitted', {
  status: StreamableStatus,
  statusReason: S.String,
}) {
  readonly [MutantReasonTypeId] = MutantReasonTypeId
}

export class ReasonRefused extends S.TaggedClass<ReasonRefused>()('ReasonRefused', {
  detail: S.String,
}) {
  readonly [MutantReasonTypeId] = MutantReasonTypeId
}

export const MutantReasonDecision = S.Union([ReasonAdmitted, ReasonRefused])
export type MutantReasonDecision = typeof MutantReasonDecision.Type

const decodeStreamableStatus = S.decodeUnknownOption(StreamableStatus)

const decodeStatusReason = S.decodeUnknownOption(Mutant.StatusReason)

const vocabularyDecisionOf = (status: StreamableStatus, statusReason: string): MutantReasonDecision =>
  Option.match(decodeStatusReason({ status, statusReason }), {
    onNone: () =>
      ReasonRefused.make({ detail: `the ${status} mutant's reason is outside its status vocabulary: ${statusReason}` }),
    onSome: () => ReasonAdmitted.make({ status, statusReason }),
  })

const settledDecisionOf = (status: StreamableStatus, statusReason: string | undefined): MutantReasonDecision =>
  Option.match(Option.fromUndefinedOr(statusReason), {
    onNone: () => ReasonRefused.make({ detail: `the ${status} mutant carries no status reason` }),
    onSome: (reason) => vocabularyDecisionOf(status, reason),
  })

export const admitMutantReason = Workflow.make({
  command: MutantReasonCommand,
  decision: MutantReasonDecision,
  error: S.Never,
  decide: (command): Result.Result<MutantReasonDecision, never> =>
    Result.succeed(
      Option.match(decodeStreamableStatus(command.status), {
        onNone: () => ReasonRefused.make({ detail: 'a Pending mutant reached the stream before it settled' }),
        onSome: (status) => settledDecisionOf(status, command.statusReason),
      }),
    ),
})
