import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const ShardPlanInvalidCode = S.Literals(['plan-unreadable', 'plan-undecodable'])
export type ShardPlanInvalidCode = typeof ShardPlanInvalidCode.Type

export class ShardPlanInvalid extends S.TaggedError<ShardPlanInvalid>()('ShardPlanInvalid', {
  file: S.String,
  detail: S.String,
  code: ShardPlanInvalidCode,
  next: S.String,
}) {
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `invalid shard plan at ${this.file} [${this.code}]: ${this.detail}; next: ${this.next}`
  }
}

const MISSING_IDS_NAMED = 5

const missingIdsTextOf = (missingIds: ReadonlyArray<string>): string =>
  `${missingIds.slice(0, MISSING_IDS_NAMED).join(', ')}${
    Option.match(Option.liftPredicate(missingIds.length - MISSING_IDS_NAMED, (rest) => rest > 0), {
      onNone: () => '',
      onSome: (rest) => `, +${rest} more`,
    })
  }`

export class ShardPlanMutantsMissing extends S.TaggedError<ShardPlanMutantsMissing>()('ShardPlanMutantsMissing', {
  planFile: S.String,
  missingIds: S.Array(S.String),
}) {
  override get message(): string {
    return `the shard plan at ${this.planFile} schedules ${this.missingIds.length} mutant(s) this run does not discover: ${
      missingIdsTextOf(this.missingIds)
    }; re-run stryker plan`
  }
}
