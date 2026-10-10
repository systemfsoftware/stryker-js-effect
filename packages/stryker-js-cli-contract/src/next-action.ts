import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { dual } from 'effect/Function'

import { AddTest, NoneNeeded, StrengthenTests } from './next-action.schema.js'

export interface NextActionFacts {
  readonly id: Mutant.MutantIdValue
  readonly file: Mutant.CanonicalFileNameValue
  readonly location: Mutant.Location
  readonly coveredBy: ReadonlyArray<string>
}

export interface NextActionByStatus {
  readonly Survived: StrengthenTests
  readonly NoCoverage: AddTest
  readonly Timeout: NoneNeeded
  readonly RuntimeError: NoneNeeded
}

export type ActionableStatus = keyof NextActionByStatus

const SHOWN_TESTS = 3

const reproducerOf = (id: Mutant.MutantIdValue): string => `stryker run --mutant ${id}`

const BY_STATUS: { readonly [Status in ActionableStatus]: (facts: NextActionFacts) => NextActionByStatus[Status] } = {
  Survived: (facts) =>
    StrengthenTests.make({
      tests: { total: facts.coveredBy.length, shown: facts.coveredBy.slice(0, SHOWN_TESTS) },
      reproduce: reproducerOf(facts.id),
    }),
  NoCoverage: (facts) =>
    AddTest.make({ file: facts.file, line: facts.location.start.line, column: facts.location.start.column }),
  Timeout: () => NoneNeeded.make({ why: 'timeout-counts-as-detected' }),
  RuntimeError: () => NoneNeeded.make({ why: 'runtime-error-excluded-from-score' }),
}

export const nextActionOf: {
  <Status extends ActionableStatus>(status: Status): (facts: NextActionFacts) => NextActionByStatus[Status]
  <Status extends ActionableStatus>(facts: NextActionFacts, status: Status): NextActionByStatus[Status]
} = dual(
  2,
  <Status extends ActionableStatus>(facts: NextActionFacts, status: Status): NextActionByStatus[Status] =>
    BY_STATUS[status](facts),
)
