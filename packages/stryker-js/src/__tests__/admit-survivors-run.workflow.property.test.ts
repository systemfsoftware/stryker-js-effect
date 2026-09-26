import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Equivalence from 'effect/Equivalence'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  admitSurvivorsRun,
  AdmitSurvivorsRunCommand,
  Admitted,
  NoSurvivors,
  PriorReportFacts,
  SurvivorsRejection,
} from '../admit-survivors-run.workflow.js'
const stringArrayEquivalence = Equivalence.Array(Equivalence.String)

const SURVIVORS_RUN_FIRST_REMEDIATION = 'run a full `stryker run` first, then re-run with --survivors'

const sha256Hex = (content: string) => bytesToHex(sha256(utf8ToBytes(content)))
const absPath = (file: string): string => `/work/${file}`

/**
 * The test's own projection of a report's survivors, so the admission's
 * coordinate conversion (report lines and columns are 1-based, mutant
 * locations 0-based) is pinned against an independent oracle instead of
 * mirroring the cell's private helper.
 */
const survivorsOf = (report: Report.MutationTestResult) =>
  Object.entries(report.files).flatMap(([file, fileResult]) =>
    fileResult.mutants
      .filter((mutant) => mutant.status === 'Survived')
      .map((mutant) => ({
        id: Mutant.MutantId.make(mutant.id),
        fileName: Mutant.CanonicalFileName.make(absPath(file)),
        relativeFileName: file,
        mutatorName: Mutant.MutatorName.make(mutant.mutatorName),
        replacement: mutant.replacement ?? mutant.mutatorName,
        location: {
          start: { line: mutant.location.start.line - 1, column: mutant.location.start.column - 1 },
          end: { line: mutant.location.end.line - 1, column: mutant.location.end.column - 1 },
        },
      }))
  )

const priorSourceHashesOf = (report: Report.MutationTestResult) =>
  Object.fromEntries(Object.entries(report.files).map(([file, fileResult]) => [file, sha256Hex(fileResult.source)]))

const intIn = (minimum: number, maximum: number) => Arbitrary.schema(S.Int.check(S.isBetween({ minimum, maximum })))

const oneOf2 = <A>(first: Arbitrary.Arbitrary<A>, second: Arbitrary.Arbitrary<A>): Arbitrary.Arbitrary<A> =>
  Arbitrary.schema(S.Boolean).pipe(Arbitrary.flatMap((pick) => (pick ? first : second)))

const reportPositionArb = Arbitrary.all({
  line: intIn(1, 200),
  column: intIn(1, 200),
})

const reportLocationArb = Arbitrary.all({ start: reportPositionArb, end: reportPositionArb })

const nonSurvivedStatusArb: Arbitrary.Arbitrary<Mutant.MutantStatus> = Arbitrary.schema(
  S.Literals(['Killed', 'NoCoverage', 'Timeout', 'RuntimeError', 'CompileError', 'Ignored', 'Pending']),
)

const mutantResultArb = (
  status: Arbitrary.Arbitrary<Mutant.MutantStatus>,
): Arbitrary.Arbitrary<Report.MutantResult> =>
  Arbitrary.all({
    id: Arbitrary.schema(Mutant.MutantId),
    mutatorName: Arbitrary.schema(Mutant.MutatorName),
    location: reportLocationArb,
    status,
    replacement: Arbitrary.schema(S.String.check(S.isMaxLength(8))),
  })

const shortKeyArb = Arbitrary.schema(S.String.check(S.isMaxLength(6)))

const recordOf = <A>(value: Arbitrary.Arbitrary<A>): Arbitrary.Arbitrary<Record<string, A>> =>
  Arbitrary.array(Arbitrary.all([shortKeyArb, value]), { maxLength: 3 }).pipe(
    Arbitrary.map((entries) => Object.fromEntries(entries)),
  )

type CleanConfig = Record<string, string | number | boolean>

const cleanConfigArb: Arbitrary.Arbitrary<CleanConfig> = recordOf(
  Arbitrary.schema(S.Union([S.String, S.Int, S.Boolean])),
)

const sourceArb = Arbitrary.schema(S.String.check(S.isMaxLength(16), S.isPattern(/^[\x20-\x7E]*$/)))

const segmentKeyArb = Arbitrary.schema(
  S.String.check(S.isMinLength(1), S.isMaxLength(6), S.isPattern(/^[\x21-\x5B\x5D-\x7E]+(\/[\x21-\x5B\x5D-\x7E]+)*$/)),
)

const survivingFilesArb: Arbitrary.Arbitrary<Record<string, Report.FileResult>> = Arbitrary.all([
  segmentKeyArb,
  Arbitrary.array(mutantResultArb(nonSurvivedStatusArb), { maxLength: 3 }),
  mutantResultArb(Arbitrary.Constant<Mutant.MutantStatus>('Survived')),
  sourceArb,
]).pipe(
  Arbitrary.map(([file, others, survivor, source]) => ({
    [file]: { language: 'javascript', source, mutants: [...others, survivor] },
  })),
)

const nonSurvivingFilesArb: Arbitrary.Arbitrary<Record<string, Report.FileResult>> = recordOf(
  Arbitrary.all({
    language: Arbitrary.Constant('javascript'),
    source: sourceArb,
    mutants: Arbitrary.array(mutantResultArb(nonSurvivedStatusArb), { maxLength: 3 }),
  }),
)

const reportArb = (
  files: Arbitrary.Arbitrary<Record<string, Report.FileResult>>,
  config: Arbitrary.Arbitrary<CleanConfig> = cleanConfigArb,
): Arbitrary.Arbitrary<Report.MutationTestResult> =>
  Arbitrary.all({
    config,
    schemaVersion: Arbitrary.Constant('1'),
    thresholds: Arbitrary.all({ high: Arbitrary.schema(S.Int), low: Arbitrary.schema(S.Int) }),
    framework: Arbitrary.all({
      name: Arbitrary.Constant('stryker'),
      version: Arbitrary.schema(S.String.check(S.isMinLength(1), S.isMaxLength(6))),
    }),
    files,
  })

const reportWithSurvivorsArb = reportArb(survivingFilesArb)
const reportWithoutSurvivorsArb = reportArb(nonSurvivingFilesArb)

const frameworklessReportArb: Arbitrary.Arbitrary<Report.MutationTestResult> = Arbitrary.all({
  config: cleanConfigArb,
  schemaVersion: Arbitrary.Constant('1'),
  thresholds: Arbitrary.all({ high: Arbitrary.schema(S.Int), low: Arbitrary.schema(S.Int) }),
  files: survivingFilesArb,
})

const survivorsProducedReportArb = reportArb(
  survivingFilesArb,
  cleanConfigArb.pipe(
    Arbitrary.map((config) => ({ ...config, survivorsPriorReport: 'reports/prior.json' })),
  ),
)

const matchingFields = (report: Report.MutationTestResult) => ({
  priorReport: PriorReportFacts.make({
    config: report.config ?? {},
    frameworkVersion: report.framework?.version,
  }),
  currentConfig: report.config ?? {},
  frameworkVersion: report.framework?.version ?? '',
  sourceContentHashes: Object.fromEntries(
    Object.entries(report.files).map(([file, fileResult]) => [
      file,
      sha256Hex(fileResult.source),
    ]),
  ),
  priorSourceHashes: priorSourceHashesOf(report),
  priorSurvivors: survivorsOf(report),
})

const matchingCommand = (report: Report.MutationTestResult): AdmitSurvivorsRunCommand =>
  AdmitSurvivorsRunCommand.make(matchingFields(report))

const driftedCommand = (report: Report.MutationTestResult): AdmitSurvivorsRunCommand =>
  AdmitSurvivorsRunCommand.make({
    ...matchingFields(report),
    frameworkVersion: `${report.framework?.version ?? ''}-drifted`,
  })

const commandWithoutPriorReport = (report: Report.MutationTestResult): AdmitSurvivorsRunCommand =>
  AdmitSurvivorsRunCommand.make({
    ...matchingFields(report),
    priorReport: undefined,
  })

const fingerprint = (
  mutant: {
    readonly id: string
    readonly fileName: string
    readonly mutatorName: string
    readonly replacement: string
    readonly location: {
      readonly start: { readonly line: number; readonly column: number }
      readonly end: { readonly line: number; readonly column: number }
    }
  },
): string =>
  JSON.stringify([
    mutant.id,
    mutant.fileName,
    mutant.mutatorName,
    mutant.replacement,
    mutant.location.start.line,
    mutant.location.start.column,
    mutant.location.end.line,
    mutant.location.end.column,
  ])

const rejectionOf = <A = unknown>(result: Result.Result<A, SurvivorsRejection>): SurvivorsRejection | undefined => {
  if (Result.isFailure(result)) {
    return result.failure
  }
  return undefined
}

describe('admitSurvivorsRun', () => {
  it.prop(
    '∀i_NoPriorReport_≡NoReportRejection',
    { of: [reportWithSurvivorsArb], subject: admitSurvivorsRun },
    (subject, [report]) => {
      const rejection = rejectionOf(subject(commandWithoutPriorReport(report)))
      if (rejection === undefined) {
        return false
      }
      return rejection.reason === 'no-report' &&
        rejection.remediation.includes('No prior mutation report found')
    },
  )

  it.prop(
    '∀r_SurvivorsProducedReport_≡RejectedAsUnusableSource',
    { of: [survivorsProducedReportArb], subject: admitSurvivorsRun },
    (subject, [report]) => {
      const rejection = rejectionOf(subject(matchingCommand(report)))
      if (rejection === undefined) {
        return false
      }
      return rejection.reason === 'mismatch' &&
        rejection.remediation.includes('itself produced by a --survivors run')
    },
  )

  it.prop(
    '∀r_NoSurvivors_≡AdmittedEmptyEvenWhenHashesDrift',
    { of: [reportWithoutSurvivorsArb], subject: admitSurvivorsRun },
    (subject, [report]) => {
      const drifted = subject(driftedCommand(report))
      if (!Result.isSuccess(drifted)) {
        return false
      }
      return S.is(NoSurvivors)(drifted.success)
    },
  )

  it.prop(
    '∀r_SurvivorsWithDriftedHashes_≡MismatchRejection',
    { of: [reportWithSurvivorsArb], subject: admitSurvivorsRun },
    (subject, [report]) => {
      const rejection = rejectionOf(subject(driftedCommand(report)))
      if (rejection === undefined) {
        return false
      }
      return rejection.reason === 'mismatch' &&
        rejection.remediation.includes('does not match the current run')
    },
  )

  it.prop(
    '∀r_SurvivorsWithMatchingHashes_≡AdmittedWithExactSurvivors',
    { of: [reportWithSurvivorsArb], subject: admitSurvivorsRun },
    (subject, [report]) => {
      const admission = subject(matchingCommand(report))
      if (!Result.isSuccess(admission)) {
        return false
      }
      if (!S.is(Admitted)(admission.success)) {
        return false
      }
      const expected = survivorsOf(report)
      return expected.length > 0 &&
        stringArrayEquivalence(
          admission.success.survivors.map(fingerprint),
          expected.map(fingerprint),
        )
    },
  )

  it.prop(
    '∀r_Report_≡AdmittedMutateSpansRe-readFromReport',
    { of: [reportWithSurvivorsArb], subject: admitSurvivorsRun },
    (subject, [report]) => {
      const admission = subject(matchingCommand(report))
      if (!Result.isSuccess(admission)) {
        return false
      }
      if (!S.is(Admitted)(admission.success)) {
        return false
      }
      const expected = survivorsOf(report).map((survivor) =>
        `${survivor.relativeFileName}:${survivor.location.start.line + 1}:${survivor.location.start.column}-${
          survivor.location.end.line + 1
        }:${survivor.location.end.column}`
      )
      return expected.length > 0 && stringArrayEquivalence(admission.success.mutateSpans, Arr.dedupe(expected))
    },
  )

  it.prop(
    '∀r_NestedConfigOrder_≡Admitted',
    { of: [reportWithSurvivorsArb, cleanConfigArb, shortKeyArb], subject: admitSurvivorsRun },
    (subject, [report, config, key]) => {
      const prior = { ...report, config: { ...config, [key]: { alpha: 1, beta: 2 } } }
      const command = AdmitSurvivorsRunCommand.make({
        ...matchingFields(prior),
        currentConfig: { ...config, [key]: { beta: 2, alpha: 1 } },
      })
      const admission = subject(command)
      return Result.isSuccess(admission) && S.is(Admitted)(admission.success)
    },
  )

  it.prop(
    '∀r_NullVsAbsentOption_≡MismatchRejection',
    { of: [reportWithSurvivorsArb, cleanConfigArb, shortKeyArb], subject: admitSurvivorsRun },
    (subject, [report, config, key]) => {
      const prior = { ...report, config: { ...config, [key]: null } }
      const command = AdmitSurvivorsRunCommand.make({
        ...matchingFields(prior),
        currentConfig: { ...config },
      })
      const rejection = rejectionOf(subject(command))
      if (rejection === undefined) {
        return false
      }
      return rejection.reason === 'mismatch' &&
        rejection.remediation.includes('does not match the current run')
    },
  )

  it.prop(
    '∀r_EveryRejection_≡EndsWithRunFirstRemediation',
    {
      of: [oneOf2<Report.MutationTestResult>(reportWithSurvivorsArb, survivorsProducedReportArb)],
      subject: admitSurvivorsRun,
    },
    (subject, [report]) => {
      const rejections = [
        rejectionOf(subject(commandWithoutPriorReport(report))),
        rejectionOf(subject(driftedCommand(report))),
      ].filter((rejection): rejection is SurvivorsRejection => rejection !== undefined)
      return rejections.length === 2 &&
        rejections.every((rejection) =>
          rejection.remediation.endsWith(` ${SURVIVORS_RUN_FIRST_REMEDIATION}`) &&
          rejection.remediation.length > SURVIVORS_RUN_FIRST_REMEDIATION.length + 1
        )
    },
  )

  it.prop(
    '∀r_ReportWithoutFramework_≡DecidesWithoutThrowing',
    { of: [frameworklessReportArb], subject: admitSurvivorsRun },
    (subject, [report]) => {
      const rejection = rejectionOf(subject(matchingCommand(report)))
      if (rejection === undefined) {
        return false
      }
      return rejection.reason === 'mismatch' && S.is(SurvivorsRejection)(rejection)
    },
  )

  it.prop(
    '∀i_EveryRejection_≡CarriesTheRejectionTag',
    { of: [reportWithSurvivorsArb], subject: admitSurvivorsRun },
    (subject, [report]) =>
      (() => {
        const r = rejectionOf(subject(commandWithoutPriorReport(report)))
        if (r === undefined) {
          return false
        }
        return S.is(SurvivorsRejection)(r)
      })(),
  )
})
