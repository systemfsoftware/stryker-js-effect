import { describe, it } from '@effect/vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import * as mutants from '@systemfsoftware/stryker-js-instrumenter'
import * as schema from '@systemfsoftware/stryker-js-plugin-interface'
import * as Equivalence from 'effect/Equivalence'
import * as Exit from 'effect/Exit'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  admitSurvivorsRun,
  AdmitSurvivorsRunCommand,
  Admitted,
  NoSurvivors,
  PriorReportFacts,
  SurvivorsAdmission,
  SurvivorsRejection,
} from '../admit-survivors-run.workflow.js'
import { SURVIVORS_RUN_FIRST_REMEDIATION } from '../Survivors.js'
import { extractSurvivors, type HashContent, priorSourceHashes, sourceContentHash } from '../Survivors.js'
const stringArrayEquivalence = Equivalence.Array(Equivalence.String)

const sha256Hex: HashContent = (content) => bytesToHex(sha256(utf8ToBytes(content)))
const absPath = (file: string): string => `/work/${file}`

const intIn = (minimum: number, maximum: number) => Arbitrary.schema(S.Int.check(S.isBetween({ minimum, maximum })))

const oneOf = <A = unknown>(...arbs: ReadonlyArray<Arbitrary.Arbitrary<A>>): Arbitrary.Arbitrary<A> =>
  intIn(0, arbs.length - 1).pipe(
    Arbitrary.flatMap((index) => {
      const chosen = arbs[index]
      if (chosen === undefined) {
        throw new Error(`oneOf was asked for an arbitrary at index ${index}, which is unbound`)
      }
      return chosen
    }),
  )

const reportPositionArb = Arbitrary.all({
  line: intIn(1, 200),
  column: intIn(1, 200),
})

const reportLocationArb = Arbitrary.all({ start: reportPositionArb, end: reportPositionArb })

const nonSurvivedStatusArb: Arbitrary.Arbitrary<mutants.MutantStatus> = Arbitrary.schema(
  S.Literals(['Killed', 'NoCoverage', 'Timeout', 'RuntimeError', 'CompileError', 'Ignored', 'Pending']),
)

const mutantResultArb = (
  status: Arbitrary.Arbitrary<mutants.MutantStatus>,
): Arbitrary.Arbitrary<schema.MutantResult> =>
  Arbitrary.all({
    id: Arbitrary.schema(S.String.check(S.isMinLength(1), S.isMaxLength(8))),
    mutatorName: Arbitrary.schema(S.String.check(S.isMinLength(1), S.isMaxLength(8))),
    location: reportLocationArb,
    status,
    replacement: Arbitrary.schema(S.String.check(S.isMaxLength(8))),
  })

const shortKeyArb = Arbitrary.schema(S.String.check(S.isMaxLength(6)))

const recordOf = <A>(value: Arbitrary.Arbitrary<A>): Arbitrary.Arbitrary<Record<string, A>> =>
  Arbitrary.array(Arbitrary.all([shortKeyArb, value]), { maxLength: 3 }).pipe(
    Arbitrary.map((entries) => Object.fromEntries(entries)),
  )

/** Keys are short enough that `survivorsPriorReport` can never be generated. */
type CleanConfig = Record<string, string | number | boolean>

const cleanConfigArb: Arbitrary.Arbitrary<CleanConfig> = recordOf(
  oneOf<string | number | boolean>(shortKeyArb, Arbitrary.schema(S.Int), Arbitrary.schema(S.Boolean)),
)

const sourceArb = Arbitrary.schema(S.String.check(S.isMaxLength(16), S.isPattern(/^[\x20-\x7E]*$/)))

const survivingFilesArb: Arbitrary.Arbitrary<Record<string, schema.FileResult>> = Arbitrary.all([
  Arbitrary.schema(S.String.check(S.isMinLength(1), S.isMaxLength(6))),
  Arbitrary.array(mutantResultArb(nonSurvivedStatusArb), { maxLength: 3 }),
  mutantResultArb(Arbitrary.Constant<mutants.MutantStatus>('Survived')),
  sourceArb,
]).pipe(
  Arbitrary.map(([file, others, survivor, source]) => ({
    [file]: { language: 'javascript', source, mutants: [...others, survivor] },
  })),
)

const nonSurvivingFilesArb: Arbitrary.Arbitrary<Record<string, schema.FileResult>> = recordOf(
  Arbitrary.all({
    language: Arbitrary.Constant('javascript'),
    source: sourceArb,
    mutants: Arbitrary.array(mutantResultArb(nonSurvivedStatusArb), { maxLength: 3 }),
  }),
)

const reportArb = (
  files: Arbitrary.Arbitrary<Record<string, schema.FileResult>>,
  config: Arbitrary.Arbitrary<CleanConfig> = cleanConfigArb,
): Arbitrary.Arbitrary<schema.MutationTestResult> =>
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

const frameworklessReportArb: Arbitrary.Arbitrary<schema.MutationTestResult> = Arbitrary.all({
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

/**
 * The fields of a command whose prior and current sides agree, as plain data. The report
 * the arbitraries build is the shape the codec accepts, so it stands in for a decoded
 * document here — the decode itself is the executor's edge, not this suite's subject.
 *
 * The two precomputed fields are built with the same helpers the edge uses, so a change to
 * either helper moves both sides of the comparison together rather than silently making
 * every admission mismatch.
 *
 * This is a record and not a command on purpose: the variants below override one field
 * each, and spreading a class instance drops its prototype while staying structurally
 * assignable — the suite would keep passing while no longer exercising a command. Spread
 * the data, construct once, and every variant is a real instance.
 */
const matchingFields = (report: schema.MutationTestResult) => ({
  priorReport: PriorReportFacts.make({
    config: report.config ?? {},
    frameworkVersion: report.framework?.version,
  }),
  currentConfig: report.config ?? {},
  frameworkVersion: report.framework?.version ?? '',
  sourceContentHashes: Object.fromEntries(
    Object.entries(report.files).map(([file, fileResult]) => [
      file,
      sourceContentHash(fileResult.source, sha256Hex),
    ]),
  ),
  priorSourceHashes: priorSourceHashes(report, sha256Hex),
  priorSurvivors: extractSurvivors(report, absPath),
})

const matchingCommand = (report: schema.MutationTestResult): AdmitSurvivorsRunCommand =>
  AdmitSurvivorsRunCommand.make(matchingFields(report))

/** The same command with the framework version drifted, so the two sides disagree. */
const driftedCommand = (report: schema.MutationTestResult): AdmitSurvivorsRunCommand =>
  AdmitSurvivorsRunCommand.make({
    ...matchingFields(report),
    frameworkVersion: `${report.framework?.version ?? ''}-drifted`,
  })

/** The same command with no prior report, so the admission has nothing to inspect. */
const commandWithoutPriorReport = (report: schema.MutationTestResult): AdmitSurvivorsRunCommand =>
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
    [reportWithSurvivorsArb],
    ([report]) => {
      const rejection = rejectionOf(
        admitSurvivorsRun(commandWithoutPriorReport(report)),
      )
      if (rejection === undefined) {
        return false
      }
      return rejection.reason === 'no-report' &&
        rejection.remediation.includes('No prior mutation report found')
    },
  )

  it.prop(
    '∀r_SurvivorsProducedReport_≡RejectedAsUnusableSource',
    [survivorsProducedReportArb],
    ([report]) => {
      const rejection = rejectionOf(admitSurvivorsRun(matchingCommand(report)))
      if (rejection === undefined) {
        return false
      }
      return rejection.reason === 'mismatch' &&
        rejection.remediation.includes('itself produced by a --survivors run')
    },
  )

  it.prop(
    '∀r_NoSurvivors_≡AdmittedEmptyEvenWhenHashesDrift',
    [reportWithoutSurvivorsArb],
    ([report]) => {
      const drifted = admitSurvivorsRun(driftedCommand(report))
      if (!Result.isSuccess(drifted)) {
        return false
      }
      return S.is(NoSurvivors)(drifted.success)
    },
  )

  it.prop(
    '∀r_SurvivorsWithDriftedHashes_≡MismatchRejection',
    [reportWithSurvivorsArb],
    ([report]) => {
      const rejection = rejectionOf(admitSurvivorsRun(driftedCommand(report)))
      if (rejection === undefined) {
        return false
      }
      return rejection.reason === 'mismatch' &&
        rejection.remediation.includes('does not match the current run')
    },
  )

  it.prop(
    '∀r_SurvivorsWithMatchingHashes_≡AdmittedWithExactSurvivors',
    [reportWithSurvivorsArb],
    ([report]) => {
      const admission = admitSurvivorsRun(matchingCommand(report))
      if (!Result.isSuccess(admission)) {
        return false
      }
      if (!S.is(Admitted)(admission.success)) {
        return false
      }
      const expected = extractSurvivors(report, absPath)
      return expected.length > 0 &&
        stringArrayEquivalence(
          admission.success.survivors.map(fingerprint),
          expected.map(fingerprint),
        )
    },
  )

  it.prop(
    '∀r_NestedConfigOrder_≡Admitted',
    [reportWithSurvivorsArb, cleanConfigArb, shortKeyArb],
    ([report, config, key]) => {
      const prior = { ...report, config: { ...config, [key]: { alpha: 1, beta: 2 } } }
      const command = AdmitSurvivorsRunCommand.make({
        ...matchingFields(prior),
        currentConfig: { ...config, [key]: { beta: 2, alpha: 1 } },
      })
      const admission = admitSurvivorsRun(command)
      return Result.isSuccess(admission) && S.is(Admitted)(admission.success)
    },
  )

  it.prop(
    '∀r_NullVsAbsentOption_≡MismatchRejection',
    [reportWithSurvivorsArb, cleanConfigArb, shortKeyArb],
    ([report, config, key]) => {
      const prior = { ...report, config: { ...config, [key]: null } }
      const command = AdmitSurvivorsRunCommand.make({
        ...matchingFields(prior),
        currentConfig: { ...config },
      })
      const rejection = rejectionOf(admitSurvivorsRun(command))
      if (rejection === undefined) {
        return false
      }
      return rejection.reason === 'mismatch' &&
        rejection.remediation.includes('does not match the current run')
    },
  )

  it.prop(
    '∀r_EveryRejection_≡EndsWithRunFirstRemediation',
    [oneOf<schema.MutationTestResult>(reportWithSurvivorsArb, survivorsProducedReportArb)],
    ([report]) => {
      const rejections = [
        rejectionOf(admitSurvivorsRun(commandWithoutPriorReport(report))),
        rejectionOf(admitSurvivorsRun(driftedCommand(report))),
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
    [frameworklessReportArb],
    ([report]) => {
      const rejection = rejectionOf(admitSurvivorsRun(matchingCommand(report)))
      if (rejection === undefined) {
        return false
      }
      return rejection.reason === 'mismatch' && S.is(SurvivorsRejection)(rejection)
    },
  )

  it.prop(
    '∀i_EveryRejection_≡CarriesTheRejectionTag',
    [reportWithSurvivorsArb],
    ([report]) =>
      (() => {
        const r = rejectionOf(admitSurvivorsRun(commandWithoutPriorReport(report)))
        if (r === undefined) {
          return false
        }
        return S.is(SurvivorsRejection)(r)
      })(),
  )

  it.prop(
    '∀m_MalformedSurvivor_≡RefusedByAdmissionDecode',
    [Arbitrary.all({ id: Arbitrary.schema(S.String), fileName: Arbitrary.schema(S.String) })],
    ([partial]) =>
      Exit.isFailure(
        S.decodeUnknownExit(SurvivorsAdmission)({ _tag: 'Admitted', survivors: [partial] }),
      ),
  )

  it.prop(
    '∀l_MalformedLocation_≡RefusedByAdmissionDecode',
    [
      oneOf(
        Arbitrary.Constant({}),
        Arbitrary.all({ start: Arbitrary.Constant({}), end: reportPositionArb }),
        Arbitrary.all({ start: reportPositionArb, end: Arbitrary.Constant({}) }),
      ),
      Arbitrary.all({
        id: Arbitrary.schema(S.String.check(S.isMinLength(1))),
        fileName: Arbitrary.schema(S.String.check(S.isMinLength(1))),
        mutatorName: Arbitrary.schema(S.String.check(S.isMinLength(1))),
        replacement: Arbitrary.schema(S.String.check(S.isMinLength(1))),
      }),
    ],
    ([location, fields]) =>
      Exit.isFailure(
        S.decodeUnknownExit(SurvivorsAdmission)({
          _tag: 'Admitted',
          survivors: [{ ...fields, location }],
        }),
      ),
  )

  it.prop(
    '∀r_WellFormedSurvivors_≡AcceptedByAdmissionDecode',
    [reportWithSurvivorsArb],
    ([report]) =>
      Exit.isSuccess(
        S.decodeExit(SurvivorsAdmission)({
          _tag: 'Admitted',
          survivors: extractSurvivors(report, absPath),
        }),
      ),
  )

  it.prop(
    '∀r_EveryVariant_≡BrandedWithTheRegistryScopedTypeId',
    [reportWithSurvivorsArb],
    ([report]) => {
      const crossRealmBrand = Symbol.for('@systemfsoftware/stryker-js/SurvivorsAdmission')
      const admitted = admitSurvivorsRun(matchingCommand(report))
      const empty = admitSurvivorsRun(matchingCommand({ ...report, files: {} }))
      const rejected = admitSurvivorsRun(commandWithoutPriorReport(report))
      return Result.isSuccess(admitted) && Result.isSuccess(empty) && Result.isFailure(rejected) &&
        crossRealmBrand in admitted.success &&
        crossRealmBrand in empty.success &&
        crossRealmBrand in rejected.failure
    },
  )
})

describe('sourceContentHash', () => {
  it.prop(
    '∀c_Empty_≡FipsVector',
    [Arbitrary.Constant('')],
    ([content]) =>
      sourceContentHash(content, sha256Hex) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )

  it.prop(
    '∀c_Abc_≡FipsVector',
    [Arbitrary.Constant('abc')],
    ([content]) =>
      sourceContentHash(content, sha256Hex) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )

  it.prop(
    '∀c_NonAscii_≡Utf8Vector',
    [Arbitrary.Constant('✓')],
    ([content]) =>
      sourceContentHash(content, sha256Hex) === '1dabba21cdad44541f6b15796f8d22978fc7ea10c46aeceeeeb66c23b3ac7604',
  )

  it.prop(
    '∀c_Content_≡Deterministic',
    [sourceArb],
    ([content]) => sourceContentHash(content, sha256Hex) === sourceContentHash(content, sha256Hex),
  )

  it.prop(
    '∀a,b_Content_≠Distinct',
    [
      Arbitrary.all([sourceArb, sourceArb]).pipe(
        Arbitrary.map(([a, b]) => {
          if (a === b) return [a, `${b}x`] as const
          return [a, b] as const
        }),
      ),
    ],
    ([[a, b]]) => sourceContentHash(a, sha256Hex) !== sourceContentHash(b, sha256Hex),
  )
})

describe('Survivors not-found', () => {
  it.prop('∀c_NotFound_≡Rejection', [Arbitrary.Constant(null)], () =>
    Result.match(
      admitSurvivorsRun(
        AdmitSurvivorsRunCommand.make({
          priorReport: undefined,
          currentConfig: {},
          frameworkVersion: '1.0.0',
          sourceContentHashes: {},
          priorSourceHashes: {},
          priorSurvivors: [],
        }),
      ),
      {
        onSuccess: () => false,
        onFailure: (rejection) => S.is(SurvivorsRejection)(rejection),
      },
    ))
})
