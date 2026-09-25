import * as S from 'effect/Schema'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Judge } from '@systemfsoftware/stryker-test-contribution'

const UNKNOWN_TEST_ID = 'unknown-test'

const TestIdSchema = S.Literals(['t1', 't2', 't3', UNKNOWN_TEST_ID])
const ConfiguredSuffixSchema = S.Literals(Judge.JudgeTestContribution.defaultRequireTestContributionSuffixes)

const TestFileSpecSchema = S.Struct({
  inScope: S.Boolean,
  tests: S.Array(TestIdSchema).check(S.isMaxLength(2)),
})
export type TestFileSpec = S.Schema.Type<typeof TestFileSpecSchema>

const MutantSpecSchema = S.Struct({
  status: Mutant.MutantStatusSchema,
  killedBy: S.Array(TestIdSchema).check(S.isMaxLength(2)),
  coveredBy: S.Array(TestIdSchema).check(S.isMaxLength(2)),
})

export const CommandSpecSchema = S.Struct({
  suffixes: S.Array(ConfiguredSuffixSchema).check(S.isMaxLength(2)),
  everyKillerRecorded: S.Boolean,
  testFiles: S.Array(TestFileSpecSchema).check(S.isMaxLength(3)),
  mutants: S.Array(MutantSpecSchema).check(S.isMaxLength(4)),
})
export type CommandSpec = S.Schema.Type<typeof CommandSpecSchema>
