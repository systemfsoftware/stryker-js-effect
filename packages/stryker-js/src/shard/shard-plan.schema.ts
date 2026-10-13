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

export class ShardPlanMutantsMissing extends S.TaggedError<ShardPlanMutantsMissing>()('ShardPlanMutantsMissing', {
  planFile: S.String,
  missingIds: S.Array(S.String),
  missingIdsText: S.String,
}) {
  override get message(): string {
    return `the shard plan at ${this.planFile} schedules ${this.missingIds.length} mutant(s) this run does not discover: ${this.missingIdsText}; re-run stryker plan`
  }
}
