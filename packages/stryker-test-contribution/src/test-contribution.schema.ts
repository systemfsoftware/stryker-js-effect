import * as S from 'effect/Schema'

import type * as pluginSchema from '@systemfsoftware/stryker-js-plugin-interface'
import { NonNegativeInt } from '@systemfsoftware/stryker-js-plugin-interface'

export interface TestFileContribution {
  readonly soleKills: number
  readonly totalKills: number
  readonly killableCovered: number
  /**
   * Whether this file covers a killing mutant that no test file was credited with.
   *
   * A `Timeout` counts as a kill but arrives with `killedBy: []` — the runner cannot say
   * which test hung, so the kill is real and attributable to nobody. Deleting a file that
   * covers one could resurrect it, which is precisely the claim this check makes, so such
   * a file is unmeasurable rather than toothless.
   */
  readonly coversUnattributedKill: boolean
}

export const TestFileContributionSchema = S.Struct({
  soleKills: NonNegativeInt,
  totalKills: NonNegativeInt,
  killableCovered: NonNegativeInt,
  coversUnattributedKill: S.Boolean,
})

export type ContributionEntry = readonly [string, TestFileContribution]
export type ReportView = Pick<pluginSchema.MutationTestResult, 'files' | 'testFiles'>

