import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Incremental } from '@systemfsoftware/stryker-js-contracts'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const DryRunFlakeDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/DryRunFlakeDecision')
type DryRunFlakeDecisionTypeId = typeof DryRunFlakeDecisionTypeId

export class DryRunFlakesDetected extends S.TaggedClass<DryRunFlakesDetected>()('DryRunFlakesDetected', {
  flakyTestIds: S.Array(S.String),
  flakyMutantIds: S.Array(S.String),
}) {
  readonly [DryRunFlakeDecisionTypeId] = DryRunFlakeDecisionTypeId
}

export class DryRunFlakesAbsent extends S.TaggedClass<DryRunFlakesAbsent>()('DryRunFlakesAbsent', {}) {
  readonly [DryRunFlakeDecisionTypeId] = DryRunFlakeDecisionTypeId
}

export type DryRunFlakeDecision = DryRunFlakesDetected | DryRunFlakesAbsent

export class DetectDryRunFlakesCommand extends S.TaggedClass<DetectDryRunFlakesCommand>()(
  'DetectDryRunFlakesCommand',
  {
    first: Incremental.DryRunPassSchema,
    second: Incremental.DryRunPassSchema,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const SENTINEL = ''

const EMPTY_PER_TEST: Mutant.CoveragePerTestId = {}

const ownOf = <A>(record: Readonly<Record<string, A>>, key: string): A | undefined =>
  Boolean.match(Object.hasOwn(record, key), {
    onTrue: () => record[key],
    onFalse: () => undefined,
  })

const statusesOf = (pass: Incremental.DryRunPass): Readonly<Record<string, string>> =>
  Object.fromEntries(pass.tests.map((test) => [test.id, test.status]))

const perTestOf = (pass: Incremental.DryRunPass): Mutant.CoveragePerTestId =>
  Option.match(Option.fromUndefinedOr(pass.mutantCoverage), {
    onNone: () => EMPTY_PER_TEST,
    onSome: (coverage) => coverage.perTest,
  })

const coveredMutantsOf = (coverage: Mutant.CoverageData): readonly string[] =>
  Object.entries(coverage).filter(([, hits]) => hits > 0).map(([mutantId]) => mutantId)

const coveredMutantsByTestOf = (pass: Incremental.DryRunPass): Readonly<Record<string, readonly string[]>> =>
  Object.fromEntries(
    Object.entries(perTestOf(pass)).map(([testId, coverage]): readonly [string, readonly string[]] => [
      testId,
      [...coveredMutantsOf(coverage)].sort(),
    ]),
  )

const unionTestIdsOf = (first: Incremental.DryRunPass, second: Incremental.DryRunPass): readonly string[] =>
  Arr.dedupe([...first.tests.map((test) => test.id), ...second.tests.map((test) => test.id)]).sort()

const statusKeyOf = (statuses: Readonly<Record<string, string>>, testId: string): string =>
  Option.getOrElse(Option.fromUndefinedOr(ownOf(statuses, testId)), () => SENTINEL)

const coverageKeyOf = (covered: Readonly<Record<string, readonly string[]>>, testId: string): string =>
  Option.getOrElse(Option.fromUndefinedOr(ownOf(covered, testId)), (): readonly string[] => []).join('\u0000')

interface PassKeys {
  readonly firstStatuses: Readonly<Record<string, string>>
  readonly secondStatuses: Readonly<Record<string, string>>
  readonly firstCovered: Readonly<Record<string, readonly string[]>>
  readonly secondCovered: Readonly<Record<string, readonly string[]>>
}

const keysOf = (command: DetectDryRunFlakesCommand): PassKeys => ({
  firstStatuses: statusesOf(command.first),
  secondStatuses: statusesOf(command.second),
  firstCovered: coveredMutantsByTestOf(command.first),
  secondCovered: coveredMutantsByTestOf(command.second),
})

const statusChanged = (keys: PassKeys, testId: string): boolean =>
  statusKeyOf(keys.firstStatuses, testId) !== statusKeyOf(keys.secondStatuses, testId)

const coveredChanged = (keys: PassKeys, testId: string): boolean =>
  coverageKeyOf(keys.firstCovered, testId) !== coverageKeyOf(keys.secondCovered, testId)

const flakyTestIdsOf = (command: DetectDryRunFlakesCommand, keys: PassKeys): readonly string[] =>
  unionTestIdsOf(command.first, command.second).filter((testId) =>
    Boolean.or(statusChanged(keys, testId), coveredChanged(keys, testId))
  )

const coveredByTest = (covered: Readonly<Record<string, readonly string[]>>, testId: string): readonly string[] =>
  Option.getOrElse(Option.fromUndefinedOr(ownOf(covered, testId)), (): readonly string[] => [])

const mutantsCoveredByTest = (keys: PassKeys, testId: string): readonly string[] => [
  ...coveredByTest(keys.firstCovered, testId),
  ...coveredByTest(keys.secondCovered, testId),
]

const flakyMutantIdsOf = (keys: PassKeys, flakyTestIds: readonly string[]): readonly string[] =>
  [...Arr.dedupe(flakyTestIds.flatMap((testId) => mutantsCoveredByTest(keys, testId)))].sort()

const decideFlakes = (command: DetectDryRunFlakesCommand): DryRunFlakeDecision => {
  const keys = keysOf(command)
  const flakyTestIds = flakyTestIdsOf(command, keys)
  return Boolean.match(flakyTestIds.length === 0, {
    onTrue: () => DryRunFlakesAbsent.make({}),
    onFalse: () =>
      DryRunFlakesDetected.make({
        flakyTestIds,
        flakyMutantIds: flakyMutantIdsOf(keys, flakyTestIds),
      }),
  })
}

export const detectDryRunFlakes = Workflow.make({
  command: DetectDryRunFlakesCommand,
  decision: S.Union([DryRunFlakesDetected, DryRunFlakesAbsent]),
  error: S.Never,
  decide: (command: DetectDryRunFlakesCommand): Result.Result<DryRunFlakeDecision, never> =>
    Result.succeed(decideFlakes(command)),
})
