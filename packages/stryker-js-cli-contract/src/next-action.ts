import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'

import { AddTest, FixConfig, nextActionTestsOf, NoneNeeded, StrengthenTests } from './next-action.schema.js'

export interface NextActionFacts {
  readonly id: Mutant.MutantIdValue
  readonly file: Mutant.CanonicalFileNameValue
  readonly location: Mutant.Location
  readonly coveredBy: ReadonlyArray<string> | null
}

export interface NextActionByStatus {
  readonly Survived: StrengthenTests | FixConfig
  readonly NoCoverage: AddTest
  readonly Timeout: NoneNeeded
  readonly RuntimeError: NoneNeeded
}

export const reproducerOf = (id: Mutant.MutantIdValue): string => `stryker run --mutant ${id}`

const MEASURE_COVERAGE =
  "Set `coverageAnalysis: 'perTest'` in the Stryker configuration so the run records which tests cover each mutant, then run again."

const BY_STATUS: {
  readonly [Status in Mutant.ActionableStatus]: (facts: NextActionFacts) => NextActionByStatus[Status]
} = {
  Survived: (facts) =>
    Option.match(Option.fromNullishOr(facts.coveredBy), {
      onNone: (): StrengthenTests | FixConfig => FixConfig.make({ remediation: MEASURE_COVERAGE }),
      onSome: (coveredBy) =>
        StrengthenTests.make({
          tests: nextActionTestsOf(coveredBy),
          reproduce: reproducerOf(facts.id),
        }),
    }),
  NoCoverage: (facts) =>
    AddTest.make({ file: facts.file, line: facts.location.start.line, column: facts.location.start.column }),
  Timeout: () => NoneNeeded.make({ why: 'timeout-counts-as-detected' }),
  RuntimeError: () => NoneNeeded.make({ why: 'runtime-error-excluded-from-score' }),
}

export const nextActionOf: {
  <Status extends Mutant.ActionableStatus>(status: Status): (facts: NextActionFacts) => NextActionByStatus[Status]
  <Status extends Mutant.ActionableStatus>(facts: NextActionFacts, status: Status): NextActionByStatus[Status]
} = dual(
  2,
  <Status extends Mutant.ActionableStatus>(facts: NextActionFacts, status: Status): NextActionByStatus[Status] =>
    BY_STATUS[status](facts),
)
