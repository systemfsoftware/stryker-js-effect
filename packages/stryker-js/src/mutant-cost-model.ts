import * as Option from 'effect/Option'
import * as Record from 'effect/Record'

import {
  type MutantCost,
  type MutantCostCase,
  MutantCostCaseSchema,
  type MutantCostModel,
  type MutantCosts,
} from './MutantCost.schema.js'

const staticHitCountOf = (staticCoverage: Record<string, number> | undefined, id: string): number =>
  Option.getOrElse(
    Option.flatMap(Option.fromNullishOr(staticCoverage), (coverage) => Record.get(coverage, id)),
    () => 0,
  )

const hasStaticHit = (staticCoverage: Record<string, number> | undefined, id: string): boolean =>
  staticCoverage === undefined || staticHitCountOf(staticCoverage, id) > 0

const runsWholeSuite = (input: MutantCostCase): boolean =>
  input.subject.static === true || hasStaticHit(input.staticCoverage, input.subject.id)

const coveringTimesOf = (input: MutantCostCase): readonly number[] =>
  runsWholeSuite(input) ? input.allTestTimesMs : input.coveringTestTimesMs

const actualMsOf = (input: MutantCostCase): number | null =>
  Option.getOrElse(
    Option.firstSomeOf([Option.fromNullishOr(input.executedActualMs), Option.fromNullishOr(input.priorActualMs)]),
    () => null,
  )

const mutantCostOfCase = (input: MutantCostCase): MutantCost => {
  const coveringTimes = coveringTimesOf(input)
  return {
    predictedMs: input.fixedOverheadMs + coveringTimes.reduce((total, time) => total + time, 0),
    actualMs: actualMsOf(input),
    coveringTests: coveringTimes.length,
  }
}

const caseOfSubject = (input: MutantCostModel, subject: MutantCostModel['subjects'][number]): MutantCostCase => ({
  subject,
  staticCoverage: input.staticCoverage,
  allTestTimesMs: input.allTestTimesMs,
  coveringTestTimesMs: Option.getOrElse(Record.get(input.coveringTestTimesMsByMutantId, subject.id), () => []),
  executedActualMs: Option.getOrUndefined(Record.get(input.executedActualMsByMutantId, subject.id)),
  priorActualMs: Option.getOrUndefined(Record.get(input.priorActualMsByMutantId, subject.id)),
  fixedOverheadMs: input.fixedOverheadMs,
})

export const mutantCostsOf = (input: MutantCostModel): MutantCosts =>
  Object.fromEntries(
    input.subjects.map((subject) => [subject.id, mutantCostOfCase(caseOfSubject(input, subject))] as const),
  )

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arbitrary = await import('effect/Arbitrary')

  const caseArb = Arbitrary.schema(MutantCostCaseSchema)

  const totalOf = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

  it.prop(
    '∀m_CostCase_≡StaticSubjectsCoverEveryTest',
    { of: [caseArb], subject: mutantCostOfCase },
    (subject, [input]) => {
      const cost = subject(input)
      return input.subject.static !== true || cost.coveringTests === input.allTestTimesMs.length
    },
  )

  it.prop(
    '∀m_CostCase_≡StaticSubjectsPredictEveryTest',
    { of: [caseArb], subject: mutantCostOfCase },
    (subject, [input]) => {
      const cost = subject(input)
      return input.subject.static !== true ||
        cost.predictedMs === input.fixedOverheadMs + totalOf(input.allTestTimesMs)
    },
  )

  it.prop(
    '∀m_CostCase_≡AbsentPerTestCoverageMeansEveryTest',
    { of: [caseArb], subject: mutantCostOfCase },
    (subject, [input]) => {
      const cost = subject(input)
      return input.staticCoverage !== undefined || cost.coveringTests === input.allTestTimesMs.length
    },
  )

  it.prop(
    '∀m_CostCase_≡PredictedMsIsMonotoneInCoveringTests',
    { of: [caseArb], subject: mutantCostOfCase },
    (subject, [input]) => {
      const overhead = input.fixedOverheadMs
      const grown: MutantCostCase = {
        ...input,
        allTestTimesMs: [...input.allTestTimesMs, overhead],
        coveringTestTimesMs: [...input.coveringTestTimesMs, overhead],
      }
      const cost = subject(input)
      const grownCost = subject(grown)
      return grownCost.predictedMs >= cost.predictedMs && grownCost.coveringTests === cost.coveringTests + 1
    },
  )

  it.prop(
    '∀m_CostCase_≡ReusedSubjectsKeepTheirLastActualMs',
    { of: [caseArb], subject: mutantCostOfCase },
    (subject, [input]) => {
      const cost = subject(input)
      const expectedActualMs = Option.getOrElse(
        Option.firstSomeOf([Option.fromNullishOr(input.executedActualMs), Option.fromNullishOr(input.priorActualMs)]),
        () => null,
      )
      return cost.actualMs === expectedActualMs
    },
  )
}
