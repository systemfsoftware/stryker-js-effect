import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

const ScoreJudgementTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ScoreJudgement')
type ScoreJudgementTypeId = typeof ScoreJudgementTypeId

const NoBreakThreshold = S.TaggedStruct('NoBreakThreshold', {})

const BreakAt = S.TaggedStruct('BreakAt', { threshold: Report.Percentage })

const BreakThresholdFromOption = S.NullOr(Report.Percentage).pipe(
  S.decodeTo(S.Union([NoBreakThreshold, BreakAt]), {
    decode: SchemaGetter.transform((threshold: number | null) =>
      Option.match(Option.fromNullOr(threshold), {
        onNone: () => NoBreakThreshold.make({}),
        onSome: (present) => BreakAt.make({ threshold: present }),
      })
    ),
    encode: SchemaGetter.forbidden(() => 'a break threshold is read from options, never written back'),
  }),
)

export class JudgeMutationScoreCommand extends S.TaggedClass<JudgeMutationScoreCommand>()('JudgeMutationScoreCommand', {
  score: Report.MutationScore,
  breakingThreshold: BreakThresholdFromOption,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ScoredWithoutThreshold extends S.TaggedClass<ScoredWithoutThreshold>()('ScoredWithoutThreshold', {
  percentage: Report.Percentage,
  exitClass: S.Null,
}) {
  readonly [ScoreJudgementTypeId] = ScoreJudgementTypeId
}

export class ScoreAtOrAboveThreshold extends S.TaggedClass<ScoreAtOrAboveThreshold>()('ScoreAtOrAboveThreshold', {
  percentage: Report.Percentage,
  threshold: Report.Percentage,
  exitClass: S.Null,
}) {
  readonly [ScoreJudgementTypeId] = ScoreJudgementTypeId
}

export class ScoreBelowThreshold extends S.TaggedClass<ScoreBelowThreshold>()('ScoreBelowThreshold', {
  percentage: Report.Percentage,
  threshold: Report.Percentage,
  exitClass: S.tag('VerdictFail'),
}) {
  readonly [ScoreJudgementTypeId] = ScoreJudgementTypeId
}

export class UnscoredAgainstThreshold extends S.TaggedClass<UnscoredAgainstThreshold>()('UnscoredAgainstThreshold', {
  threshold: Report.Percentage,
  exitClass: S.Null,
}) {
  readonly [ScoreJudgementTypeId] = ScoreJudgementTypeId
}

export class UnscoredWithoutThreshold extends S.TaggedClass<UnscoredWithoutThreshold>()('UnscoredWithoutThreshold', {
  exitClass: S.Null,
}) {
  readonly [ScoreJudgementTypeId] = ScoreJudgementTypeId
}

export const ScoreJudgement = S.Union([
  ScoredWithoutThreshold,
  ScoreAtOrAboveThreshold,
  ScoreBelowThreshold,
  UnscoredAgainstThreshold,
  UnscoredWithoutThreshold,
])
export type ScoreJudgement = typeof ScoreJudgement.Type

const scoredAgainst = (percentage: number) => (threshold: number): ScoreJudgement =>
  Match.value(percentage < threshold).pipe(
    Match.when(true, () => ScoreBelowThreshold.make({ percentage, threshold })),
    Match.when(false, () => ScoreAtOrAboveThreshold.make({ percentage, threshold, exitClass: null })),
    Match.exhaustive,
  )

const decide = (command: JudgeMutationScoreCommand): Result.Result<ScoreJudgement, never> =>
  Result.succeed(
    Match.valueTags(command.score, {
      Scored: ({ percentage }) =>
        Match.valueTags(command.breakingThreshold, {
          NoBreakThreshold: (): ScoreJudgement => ScoredWithoutThreshold.make({ percentage, exitClass: null }),
          BreakAt: ({ threshold }) => scoredAgainst(percentage)(threshold),
        }),
      Unscored: () =>
        Match.valueTags(command.breakingThreshold, {
          NoBreakThreshold: (): ScoreJudgement => UnscoredWithoutThreshold.make({ exitClass: null }),
          BreakAt: ({ threshold }): ScoreJudgement => UnscoredAgainstThreshold.make({ threshold, exitClass: null }),
        }),
    }),
  )

export const judgeMutationScore = Workflow.make({
  command: JudgeMutationScoreCommand,
  decision: ScoreJudgement,
  error: S.Never,
  decide,
})
