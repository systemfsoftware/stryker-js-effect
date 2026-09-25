import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Report } from '@systemfsoftware/stryker-js-plugin-interface'

import {
  DuplicatePackageLabel,
  MergedReports,
  mergeReportParts,
  MergeReportPartsCommand,
  MissingPackages,
  type NoMergedReports,
  type ReportPart,
} from '../merge-report-parts.workflow.js'

const LOCATION = {
  start: { line: 1, column: 1 },
  end: { line: 1, column: 10 },
}

const STATUS_ARB: Arbitrary.Arbitrary<Mutant.MutantStatus> = Arbitrary.schema(
  S.Literals(['Killed', 'Survived', 'NoCoverage', 'CompileError', 'RuntimeError', 'Timeout', 'Ignored', 'Pending']),
)

const SCORED_STATUSES: Readonly<Record<string, true>> = {
  Killed: true,
  Timeout: true,
  Survived: true,
  NoCoverage: true,
}

interface ModuleSpec {
  readonly label: string
  readonly testIds: readonly string[]
  readonly mutants: readonly {
    readonly id: string
    readonly status: Mutant.MutantStatus
    readonly killingIds: readonly string[]
  }[]
}

const MODULE_ARB: Arbitrary.Arbitrary<ModuleSpec> = Arbitrary.all({
  label: Arbitrary.schema(S.String.check(S.isPattern(/^[a-z][a-z0-9]{0,5}$/))),
  testIds: Arbitrary.schema(
    S.UniqueArray(S.String.check(S.isPattern(/^t[0-9]{1,3}$/))).check(S.isMinLength(1), S.isMaxLength(3)),
  ),
}).pipe(
  Arbitrary.flatMap(({ label, testIds }) =>
    Arbitrary.array(
      Arbitrary.all({
        status: STATUS_ARB,
        reach: Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: testIds.length }))),
      }),
      { minLength: 1, maxLength: 3 },
    ).pipe(
      Arbitrary.map((specs) => ({
        label,
        testIds,
        mutants: specs.map((spec, index) => ({
          id: `m${index}`,
          status: spec.status,
          killingIds: testIds.slice(0, spec.reach),
        })),
      })),
    )
  ),
)

const MODULES_ARB = Arbitrary.array(MODULE_ARB, { minLength: 1, maxLength: 3 })

const reportOf = (spec: ModuleSpec): Report.MutationTestResult => ({
  schemaVersion: '1.0',
  thresholds: { high: 80, low: 60 },
  files: {
    'src/target.ts': {
      language: 'typescript',
      source: 'const marker = true',
      mutants: spec.mutants.map((mutant) => ({
        id: mutant.id,
        mutatorName: 'BooleanLiteral',
        replacement: 'false',
        status: mutant.status,
        location: LOCATION,
        killedBy: [...mutant.killingIds],
        coveredBy: [...mutant.killingIds],
      })),
    },
  },
  testFiles: {
    'src/target.test.ts': { tests: spec.testIds.map((id) => ({ id, name: `test ${id}` })) },
  },
})

const partOf = (spec: ModuleSpec): S.Schema.Type<typeof ReportPart> => ({
  label: spec.label,
  outcome: 'success',
  incomplete: false,
  report: reportOf(spec),
})

const commandOf = (specs: readonly ModuleSpec[]): MergeReportPartsCommand =>
  MergeReportPartsCommand.make({ parts: specs.map(partOf) })

const hasDistinctLabels = (specs: readonly ModuleSpec[]): boolean =>
  new Set(specs.map((spec) => spec.label)).size === specs.length

const DISTINCT_MODULES_ARB = MODULES_ARB.pipe(Arbitrary.filter(hasDistinctLabels))

const mergedOf = (
  result: Result.Result<MergedReports | NoMergedReports, DuplicatePackageLabel | MissingPackages>,
): MergedReports | undefined => {
  if (Result.isFailure(result)) {
    return undefined
  }
  if (!S.is(MergedReports)(result.success)) {
    return undefined
  }
  return result.success
}

describe('mergeReportParts', () => {
  it.prop(
    '∀cs_Modules_≡MutantCountIsConserved',
    { of: [DISTINCT_MODULES_ARB], subject: mergeReportParts },
    (subject, [specs]) => {
      const merged = mergedOf(subject(commandOf(specs)))
      if (merged === undefined) {
        return false
      }
      const expected = specs.reduce((total, spec) => total + spec.mutants.length, 0)
      const actual = Object.values(merged.report.files).reduce((total, file) => total + file.mutants.length, 0)
      return actual === expected
    },
  )

  it.prop(
    '∀cs_Modules_≡EveryReferenceResolvesInsideTheMergedReport',
    { of: [DISTINCT_MODULES_ARB], subject: mergeReportParts },
    (subject, [specs]) => {
      const merged = mergedOf(subject(commandOf(specs)))
      if (merged === undefined) {
        return false
      }
      const testIds = new Set(
        Object.values(merged.report.testFiles ?? {}).flatMap((file) => file.tests.map((test) => test.id)),
      )
      return Object.values(merged.report.files).every((file) =>
        file.mutants.every((mutant) =>
          [...(mutant.killedBy ?? []), ...(mutant.coveredBy ?? [])].every((id) => testIds.has(id))
        )
      )
    },
  )

  it.prop(
    '∀cs_Modules_≡MergedKeysCarryTheModuleThatOwnsThem',
    { of: [DISTINCT_MODULES_ARB], subject: mergeReportParts },
    (subject, [specs]) => {
      const merged = mergedOf(subject(commandOf(specs)))
      if (merged === undefined) {
        return false
      }
      const labels = new Set(specs.map((spec) => spec.label))
      const entries = Object.entries(merged.report.files)
      return entries.length === specs.length &&
        entries.every(([key, file]) =>
          labels.has(key.slice(0, key.indexOf('/'))) &&
          file.mutants.every((mutant) => mutant.id.startsWith(`${key.slice(0, key.indexOf('/'))}_`))
        )
    },
  )

  it.prop('∀cs_Modules_≡RepeatedModuleRefused', { of: [MODULE_ARB], subject: mergeReportParts }, (subject, [spec]) => {
    const repeated = MergeReportPartsCommand.make({ parts: [partOf(spec), partOf(spec)] })
    const result = subject(repeated)
    return Result.isFailure(result) &&
      S.is(DuplicatePackageLabel)(result.failure) &&
      result.failure.label === spec.label
  })

  it.prop(
    '∀cs_Modules_≡AbsentModuleBecomesAnEmptyReportRow',
    { of: [DISTINCT_MODULES_ARB], subject: mergeReportParts },
    (subject, [specs]) => {
      const absent = 'not-a-generated-module'
      const result = subject(
        MergeReportPartsCommand.make({ parts: specs.map(partOf), expectedPackages: [absent] }),
      )
      if (Result.isFailure(result)) {
        return false
      }
      return result.success.rows.some((row) => row.label === absent && row.score === 'no report')
    },
  )

  it.prop(
    '∀cs_Modules_≡UnscoredRowIffNoMutantCountsTowardTheScore',
    { of: [DISTINCT_MODULES_ARB], subject: mergeReportParts },
    (subject, [specs]) => {
      const result = subject(commandOf(specs))
      return Result.isSuccess(result) &&
        specs.every((spec) =>
          result.success.rows.some((row) =>
            row.label === spec.label &&
            (row.score === 'n/a') === spec.mutants.every((mutant) => SCORED_STATUSES[mutant.status] !== true)
          )
        )
    },
  )
})
