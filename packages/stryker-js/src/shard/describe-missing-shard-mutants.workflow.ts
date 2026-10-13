import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const MissingShardMutantsTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MissingShardMutants')
type MissingShardMutantsTypeId = typeof MissingShardMutantsTypeId

const MISSING_IDS_NAMED = 5

export class DescribeMissingShardMutantsCommand extends S.TaggedClass<DescribeMissingShardMutantsCommand>()(
  'DescribeMissingShardMutantsCommand',
  {
    missingIds: S.Array(S.String),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class MissingShardMutantsNamed extends S.TaggedClass<MissingShardMutantsNamed>()('MissingShardMutantsNamed', {
  text: S.String,
}) {
  readonly [MissingShardMutantsTypeId] = MissingShardMutantsTypeId
}

export class MissingShardMutantsTruncated extends S.TaggedClass<MissingShardMutantsTruncated>()(
  'MissingShardMutantsTruncated',
  {
    text: S.String,
  },
) {
  readonly [MissingShardMutantsTypeId] = MissingShardMutantsTypeId
}

export const DescribeMissingShardMutantsDecision = S.Union([MissingShardMutantsNamed, MissingShardMutantsTruncated])
export type DescribeMissingShardMutantsDecision = typeof DescribeMissingShardMutantsDecision.Type

const namedIds = (missingIds: ReadonlyArray<string>): string => missingIds.slice(0, MISSING_IDS_NAMED).join(', ')

const unnamedCount = (missingIds: ReadonlyArray<string>): number => missingIds.length - MISSING_IDS_NAMED

const describedOf = (missingIds: ReadonlyArray<string>): DescribeMissingShardMutantsDecision =>
  Boolean.match(unnamedCount(missingIds) > 0, {
    onTrue: () =>
      MissingShardMutantsTruncated.make({
        text: `${namedIds(missingIds)}, +${unnamedCount(missingIds)} more`,
      }),
    onFalse: () => MissingShardMutantsNamed.make({ text: namedIds(missingIds) }),
  })

export const describeMissingShardMutants = Workflow.make({
  command: DescribeMissingShardMutantsCommand,
  decision: DescribeMissingShardMutantsDecision,
  error: S.Never,
  decide: (command: DescribeMissingShardMutantsCommand): Result.Result<DescribeMissingShardMutantsDecision, never> =>
    Result.succeed(describedOf(command.missingIds)),
})
