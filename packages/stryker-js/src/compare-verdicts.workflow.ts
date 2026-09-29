import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ABSENT_STATUS = 'absent'

export const VerdictStatus = S.Struct({
  id: S.String,
  status: S.String,
})

export type VerdictStatus = typeof VerdictStatus.Type

export const VerdictSchema = S.Struct({
  files: S.Record(S.String, S.Struct({ mutants: S.Array(VerdictStatus) })),
})

export type VerdictReport = typeof VerdictSchema.Type

export const VerdictMismatch = S.Struct({
  id: S.String,
  baseline: S.String,
  fresh: S.String,
})

export type VerdictMismatch = typeof VerdictMismatch.Type

const CompareVerdictsDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/CompareVerdictsDecision')
type CompareVerdictsDecisionTypeId = typeof CompareVerdictsDecisionTypeId

export class VerdictsMatch extends S.TaggedClass<VerdictsMatch>()('VerdictsMatch', {}) {
  readonly [CompareVerdictsDecisionTypeId] = CompareVerdictsDecisionTypeId
}

export class VerdictsDiffer extends S.TaggedError<VerdictsDiffer>()('VerdictsDiffer', {
  mismatches: S.Array(VerdictMismatch),
}) {
  override get message(): string {
    return [
      `${this.mismatches.length} mutant status(es) differ from the baseline:`,
      ...this.mismatches.map((mismatch) => `  ${mismatch.id}: ${mismatch.baseline} -> ${mismatch.fresh}`),
    ].join('\n')
  }
}

export class CompareVerdictsCommand extends S.Class<CompareVerdictsCommand>('CompareVerdictsCommand')({
  baseline: VerdictSchema,
  fresh: VerdictSchema,
  noise: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class CompareFailed extends S.TaggedError<CompareFailed>()('CompareFailed', {
  reason: S.String,
}) {
  override get message(): string {
    return `stryker compare: ${this.reason}`
  }
}

const idsOf = (report: VerdictReport): readonly string[] =>
  Object.values(report.files).flatMap((file) => file.mutants.map((mutant) => mutant.id))

const statusesOf = (report: VerdictReport): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.values(report.files).flatMap((file) =>
      file.mutants.map((mutant): readonly [string, string] => [mutant.id, mutant.status])
    ),
  )

const statusOrAbsent = (statuses: Readonly<Record<string, string>>, id: string): string =>
  Option.getOrElse(Option.fromUndefinedOr(statuses[id]), () => ABSENT_STATUS)

const mismatchAt = (
  id: string,
  baseline: Readonly<Record<string, string>>,
  fresh: Readonly<Record<string, string>>,
): Option.Option<VerdictMismatch> => {
  const before = statusOrAbsent(baseline, id)
  const after = statusOrAbsent(fresh, id)
  return Option.map(
    Option.liftPredicate({ id, before, after }, (pair) => pair.before !== pair.after),
    (pair) => VerdictMismatch.make({ id: pair.id, baseline: pair.before, fresh: pair.after }),
  )
}

const mismatchesOf = (command: CompareVerdictsCommand): readonly VerdictMismatch[] => {
  const baseline = statusesOf(command.baseline)
  const fresh = statusesOf(command.fresh)
  const noise = HashSet.fromIterable(command.noise)
  return [...HashSet.fromIterable([...idsOf(command.baseline), ...idsOf(command.fresh)])]
    .filter((id) => !HashSet.has(noise, id))
    .sort()
    .flatMap((id) => Option.toArray(mismatchAt(id, baseline, fresh)))
}

const decide = (command: CompareVerdictsCommand): Result.Result<VerdictsMatch, VerdictsDiffer> => {
  const mismatches = mismatchesOf(command)
  return Option.match(Option.fromUndefinedOr(mismatches[0]), {
    onNone: () => Result.succeed(VerdictsMatch.make({})),
    onSome: () => Result.fail(VerdictsDiffer.make({ mismatches })),
  })
}

export const compareVerdicts = Workflow.make({
  command: CompareVerdictsCommand,
  decision: VerdictsMatch,
  error: VerdictsDiffer,
  decide,
})
