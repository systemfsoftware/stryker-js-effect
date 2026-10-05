import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const MutantCost = S.Struct({
  predictedMs: S.Finite,
  actualMs: S.NullOr(S.Finite),
  coveringTests: S.Int,
})
export type MutantCost = typeof MutantCost.Type

export const MutantCosts = S.Record(Mutant.MutantId, MutantCost)
export type MutantCosts = typeof MutantCosts.Type

const MutantCostSubject = S.Struct({ id: Mutant.MutantId, static: S.optional(S.Boolean) })

export const MutantCostCaseSchema = S.Struct({
  subject: MutantCostSubject,
  staticCoverage: S.optional(S.Record(S.String, Report.NonNegativeFinite)),
  allTestTimesMs: S.Array(Report.NonNegativeFinite),
  coveringTestTimesMs: S.Array(Report.NonNegativeFinite),
  executedActualMs: S.optional(Report.NonNegativeFinite),
  priorActualMs: S.optional(Report.NonNegativeFinite),
  fixedOverheadMs: Report.NonNegativeFinite,
})
export type MutantCostCase = typeof MutantCostCaseSchema.Type

export const MutantCostModelSchema = S.Struct({
  subjects: S.Array(MutantCostSubject),
  staticCoverage: S.optional(S.Record(S.String, Report.NonNegativeFinite)),
  allTestTimesMs: S.Array(Report.NonNegativeFinite),
  coveringTestTimesMsByMutantId: S.Record(S.String, S.Array(Report.NonNegativeFinite)),
  executedActualMsByMutantId: S.Record(S.String, Report.NonNegativeFinite),
  priorActualMsByMutantId: S.Record(S.String, Report.NonNegativeFinite),
  fixedOverheadMs: Report.NonNegativeFinite,
})
export type MutantCostModel = typeof MutantCostModelSchema.Type
