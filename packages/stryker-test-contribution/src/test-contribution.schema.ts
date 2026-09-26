import * as S from 'effect/Schema'

import { Report } from '@systemfsoftware/stryker-js-plugin-interface'

export const TestFileContributionSchema = S.Struct({
  soleKills: Report.NonNegativeInt,
  totalKills: Report.NonNegativeInt,
  killableCovered: Report.NonNegativeInt,
  coversUnattributedKill: S.Boolean,
})

export type TestFileContribution = typeof TestFileContributionSchema.Type

export type ContributionEntry = readonly [string, TestFileContribution]
export type ReportView = Pick<Report.MutationTestResult, 'files' | 'testFiles'>
