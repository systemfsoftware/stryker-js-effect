import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Report, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const VitestTestRecord = S.Struct({
  name: S.String,
  fullTestName: S.optional(S.String),
  suiteNames: S.Array(S.String),
  fileName: S.optional(S.String),
  mode: S.optional(S.String),
  state: S.optional(S.String),
  durationMs: S.optional(Report.NonNegativeFinite),
  errorMessage: S.optional(S.String),
  suiteErrorMessage: S.optional(S.String),
})
export type VitestTestRecord = S.Schema.Type<typeof VitestTestRecord>

export const VitestFileFailure = S.Struct({
  fileName: S.String,
  message: S.String,
})
export type VitestFileFailure = S.Schema.Type<typeof VitestFileFailure>

export const VitestTestRun = S.Struct({
  projectRoot: S.String,
  records: S.Array(VitestTestRecord),
  fileFailures: S.Array(VitestFileFailure),
})
export type VitestTestRun = S.Schema.Type<typeof VitestTestRun>

export class VitestDryRunCommand extends S.TaggedClass<VitestDryRunCommand>()('VitestDryRunCommand', {
  projectRoot: S.String,
  tests: S.Array(TestRunner.TestResultSchema),
  hasExternalError: S.Boolean,
  externalErrorText: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    projectRoot: 'stryker.vitest.project_root',
  } as const
}

export class VitestMutantRunCommand extends S.TaggedClass<VitestMutantRunCommand>()('VitestMutantRunCommand', {
  tests: S.Array(TestRunner.TestResultSchema),
  hasExternalError: S.Boolean,
  externalErrorText: S.String,
  hitCount: S.optional(Report.NonNegativeInt),
  hitLimit: S.optional(Report.NonNegativeInt),
  reportAllKillers: S.Boolean,
  activeMutantId: Mutant.MutantId,
  activeMutantFileName: Mutant.CanonicalFileName,
  timeoutTrapFile: S.optional(S.String),
  timeoutTrapMutantId: S.optional(Mutant.MutantId),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    activeMutantId: 'stryker.vitest.active_mutant_id',
    reportAllKillers: 'stryker.vitest.report_all_killers',
  } as const
}
