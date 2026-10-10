import { Mutant, Options, type Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

const AuditSchemaVersion = S.Literal('1')

const Count = S.Int.check(S.isGreaterThanOrEqualTo(0))

export const KillMatrixReport = S.Struct({
  projectRoot: S.String,
  mutantSetPolicy: Options.MutantSetPolicy,
  files: S.Record(
    S.String,
    S.Struct({
      source: S.String,
      mutants: S.Array(S.Struct({
        id: S.String,
        status: Mutant.MutantStatusSchema,
        killedBy: S.String.pipe(S.Array, S.optionalKey),
      })),
    }),
  ),
  testFiles: S.Record(S.String, S.Struct({ tests: S.Array(S.Struct({ id: S.String })) })),
})
export type KillMatrixReport = typeof KillMatrixReport.Type
export const KillMatrixReportJson = S.fromJsonString(KillMatrixReport)

export const CountedReport = S.Struct({
  files: S.Record(
    S.String,
    S.Struct({
      mutants: S.Array(S.Struct({
        id: S.String,
        status: Mutant.MutantStatusSchema,
        statusReason: S.String.pipe(S.optionalKey),
        testsCompleted: Count.pipe(S.optionalKey),
      })),
    }),
  ),
  costs: S.Record(S.String, S.Struct({ actualMs: S.NullOr(S.Finite) })).pipe(S.optionalKey),
})
export type CountedReport = typeof CountedReport.Type
export const CountedReportJson = S.fromJsonString(CountedReport)

export const AuditScope = S.Union([
  S.TaggedStruct('Corpus', {}),
  S.TaggedStruct('Files', { files: S.NonEmptyArray(S.String) }),
])
export type AuditScope = typeof AuditScope.Type

export const PassReason = S.Literals(['killers-contained', 'dropped-mutant-carries-no-kill-signal'])
export const VacuousReason = S.Literals(['dominator-survived', 'dominator-uncovered'])
export const UnverifiedReason = S.Literals([
  'killer-is-file-hook',
  'killer-unrecorded',
  'dropped-mutant-timed-out',
  'dominator-timed-out',
])
export const FailReason = S.Literals([
  'killers-not-contained',
  'dropped-mutant-survives',
  'misidentified-pair',
  'dominator-not-run',
])
export const UnjoinableReason = S.Literals(['mutant-absent', 'dominator-absent', 'status-unsettled'])

export const PairVerdict = S.Union([
  S.TaggedStruct('Pass', { reason: PassReason }),
  S.TaggedStruct('Vacuous', { reason: VacuousReason }),
  S.TaggedStruct('AttributionUnverified', { reason: UnverifiedReason }),
  S.TaggedStruct('Fail', { reason: FailReason }),
])
export type PairVerdict = typeof PairVerdict.Type

const PairFields = {
  project: S.String,
  rule: Mutant.Subsumed.fields.rule,
  mutant: Mutant.MutantId,
  dominator: Mutant.MutantId,
  next: S.String,
}

const JoinedPair = S.TaggedStruct('JoinedPair', {
  ...PairFields,
  mutantStatus: Mutant.MutantStatusSchema,
  dominatorStatus: Mutant.MutantStatusSchema,
  missingKillers: S.Array(S.String),
  verdict: PairVerdict,
})

const UnjoinablePair = S.TaggedStruct('UnjoinablePair', {
  ...PairFields,
  reason: UnjoinableReason,
})

export const AuditedPair = S.Union([JoinedPair, UnjoinablePair])
export type AuditedPair = typeof AuditedPair.Type

const RuleCounts = {
  rule: Mutant.Subsumed.fields.rule,
  drops: Count,
  pass: Count,
  vacuous: Count,
  attributionUnverified: Count,
  fail: Count,
  unjoinable: Count,
}

export const RuleSummary = S.Union([
  S.TaggedStruct('Attested', RuleCounts),
  S.TaggedStruct('Unattested', { ...RuleCounts, reason: S.Literal('no-drop-joined'), next: S.String }),
])
export type RuleSummary = typeof RuleSummary.Type

export const OrphanedTest = S.Struct({
  project: S.String,
  test: S.String,
  killed: S.NonEmptyArray(S.String),
  reason: S.Literal('every-killed-mutant-dropped'),
  next: S.String,
})
export type OrphanedTest = typeof OrphanedTest.Type

const ProjectDrops = S.Struct({
  project: S.String,
  matrixMutants: Count,
  drops: Count,
})

const DropAuditFields = {
  schemaVersion: AuditSchemaVersion,
  scope: AuditScope,
  projects: S.Array(ProjectDrops),
  rules: S.Array(RuleSummary),
  pairs: S.Array(AuditedPair),
  orphanedTests: S.Array(OrphanedTest),
}

const AuditFailures = S.Struct({ pairs: Count, unattestedRules: Count, orphanedTests: Count })

const AuditReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/AuditReport')

export class DropAuditPassed extends S.TaggedClass<DropAuditPassed>()('DropAuditPassed', DropAuditFields) {
  readonly [AuditReportTypeId] = AuditReportTypeId
}

export class DropAuditFailed extends S.TaggedClass<DropAuditFailed>()('DropAuditFailed', {
  ...DropAuditFields,
  failures: AuditFailures,
}) {
  readonly [AuditReportTypeId] = AuditReportTypeId
}

export const DropAuditReport = S.Union([DropAuditPassed, DropAuditFailed])
export type DropAuditReport = typeof DropAuditReport.Type

export const MatrixMutant = S.Struct({
  id: S.String,
  status: Mutant.MutantStatusSchema,
  killedBy: S.Array(S.String),
})
export type MatrixMutant = typeof MatrixMutant.Type

export const MatrixProject = S.Struct({
  project: S.String,
  mutants: S.Array(MatrixMutant),
  tests: S.Array(S.String),
})
export type MatrixProject = typeof MatrixProject.Type

export const AuditedDrop = S.Struct({
  project: S.String,
  mutant: Mutant.MutantId,
  subsumed: Mutant.Subsumed,
})
export type AuditedDrop = typeof AuditedDrop.Type

export const StatusCounts = S.Struct({
  Killed: Count,
  Survived: Count,
  NoCoverage: Count,
  CompileError: Count,
  RuntimeError: Count,
  Timeout: Count,
  Ignored: Count,
  Pending: Count,
})
export type StatusCounts = typeof StatusCounts.Type

export const RunCounts = S.Struct({
  planned: Count,
  statuses: StatusCounts,
  ignoredByRule: S.Array(S.Struct({ rule: Mutant.IgnoreRuleId, count: Count })),
  ignoredUnrecognized: Count,
  compileErrorShare: S.Finite,
  compiled: Count,
  executed: Count,
  testExecutions: Count,
  compileErrorCheckerMs: S.Finite,
})
export type RunCounts = typeof RunCounts.Type

export class CountsReport extends S.TaggedClass<CountsReport>()('Counts', {
  schemaVersion: AuditSchemaVersion,
  projects: S.Array(S.Struct({ project: S.String, counts: RunCounts })),
  total: RunCounts,
}) {
  readonly [AuditReportTypeId] = AuditReportTypeId
}

export const AuditReport = S.Union([DropAuditPassed, DropAuditFailed, CountsReport])
export type AuditReport = typeof AuditReport.Type
export const AuditReportJson = S.fromJsonString(AuditReport)

export const CountedProject = S.Struct({ project: S.String, report: CountedReport })

export class NothingCounted extends S.TaggedError<NothingCounted>()('NothingCounted', {
  projects: S.Array(S.String),
}) {
  readonly exitClass = 'ConfigError' satisfies Plugin.ExitClass
  readonly code = 'no-mutant-recorded' as const

  get reason(): string {
    return [
      `stryker audit (${this.code}): the incremental reports of ${this.projects.join(', ')} record no mutant.`,
      "Pass --matrix the directory of a finished run's reports and --projects the directories it ran.",
    ].join(' ')
  }

  override get message(): string {
    return this.reason
  }
}

export class AuditFailed extends S.TaggedError<AuditFailed>()('AuditFailed', {
  failures: AuditFailures,
  report: S.String,
}) {
  readonly exitClass = 'VerdictFail' satisfies Plugin.ExitClass

  override get message(): string {
    return [
      `stryker audit: dropping these mutants loses kill signal: ${this.failures.pairs} failed pair(s),`,
      `${this.failures.unattestedRules} unattested rule(s), ${this.failures.orphanedTests} orphaned test(s).`,
      `Each entry in ${this.report} carries its reason code and next action.`,
    ].join(' ')
  }
}

const AuditInputCode = S.Literals([
  'matrix-unreadable',
  'matrix-undecodable',
  'matrix-not-full',
  'files-outside-matrix',
  'files-with-counts-only',
])

export class AuditInputUnusable extends S.TaggedError<AuditInputUnusable>()('AuditInputUnusable', {
  code: AuditInputCode,
  detail: S.String,
  next: S.String,
}) {
  readonly exitClass = 'ConfigError' satisfies Plugin.ExitClass

  get reason(): string {
    return `stryker audit (${this.code}): ${this.detail}. ${this.next}`
  }

  override get message(): string {
    return this.reason
  }
}
