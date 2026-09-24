import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ConcurrencyDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ConcurrencySplit')
type ConcurrencyDecisionTypeId = typeof ConcurrencyDecisionTypeId

const PERCENTAGE_OPTION = /^(100|[1-9]?[0-9])%$/

export class TestRunnersOnly extends S.TaggedClass<TestRunnersOnly>()('TestRunnersOnly', {
  testRunners: S.Finite,
  total: S.Finite,
  isPercentage: S.Boolean,
}) {
  readonly [ConcurrencyDecisionTypeId] = ConcurrencyDecisionTypeId
}

export class TestRunnersAndCheckers extends S.TaggedClass<TestRunnersAndCheckers>()(
  'TestRunnersAndCheckers',
  {
    testRunners: S.Finite,
    checkers: S.Finite,
    total: S.Finite,
    isPercentage: S.Boolean,
  },
) {
  readonly [ConcurrencyDecisionTypeId] = ConcurrencyDecisionTypeId
}

export const ConcurrencySplit = S.Union([TestRunnersOnly, TestRunnersAndCheckers])
export type ConcurrencySplit = typeof ConcurrencySplit.Type

export class ResolveConcurrency extends S.TaggedClass<ResolveConcurrency>()('ResolveConcurrency', {
  concurrency: S.optional(S.Union([S.Finite, S.String])),
  checkerCount: S.Natural,
  availableParallelism: S.Natural,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    checkerCount: 'stryker.concurrency.checker_count',
  } as const
}

const { ceil, floor, max, round } = Math

const percentageOf = (text: string) =>
  Option.map(
    Option.flatMap(Option.fromNullishOr(PERCENTAGE_OPTION.exec(text)), (match) => Option.fromNullishOr(match[1])),
    (digits) => Number.parseInt(digits, 10),
  )
const percentageTotal = (percentage: number, availableParallelism: number) =>
  max(1, round((availableParallelism * percentage) / 100))

const defaultedTotal = (availableParallelism: number) =>
  Boolean.match(availableParallelism > 4, {
    onTrue: () => availableParallelism - 1,
    onFalse: () => availableParallelism,
  })

const percentageDetails = (text: string, availableParallelism: number) =>
  Option.match(percentageOf(text), {
    onSome: (percentage) => ({
      total: percentageTotal(percentage, availableParallelism),
      isPercentage: true,
    }),
    onNone: () => ({ total: defaultedTotal(availableParallelism), isPercentage: false }),
  })

const detailsOf = (concurrency: number | string | undefined, availableParallelism: number) =>
  Match.value(concurrency).pipe(
    Match.when(Predicate.isString, (text) => percentageDetails(text, availableParallelism)),
    Match.when(Predicate.isNumber, (total) => ({ total, isPercentage: false })),
    Match.orElse(() => ({ total: defaultedTotal(availableParallelism), isPercentage: false })),
  )

const splitOf = (
  details: { readonly total: number; readonly isPercentage: boolean },
  checkerCount: number,
): ConcurrencySplit =>
  Boolean.match(checkerCount > 0, {
    onTrue: () =>
      TestRunnersAndCheckers.make({
        testRunners: max(floor(details.total / 2), 1),
        checkers: max(ceil(details.total / 2), 1),
        total: details.total,
        isPercentage: details.isPercentage,
      }),
    onFalse: () =>
      TestRunnersOnly.make({
        testRunners: details.total,
        total: details.total,
        isPercentage: details.isPercentage,
      }),
  })

const decide = (command: ResolveConcurrency): Result.Result<ConcurrencySplit, never> =>
  Result.succeed(splitOf(detailsOf(command.concurrency, command.availableParallelism), command.checkerCount))

export const resolveConcurrency = Workflow.make({
  command: ResolveConcurrency,
  decision: ConcurrencySplit,
  error: S.Never,
  decide,
})
