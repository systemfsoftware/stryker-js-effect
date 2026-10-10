import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Num from 'effect/Number'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ComparisonDecision,
  type ObservedVerdict,
  type ParityBroken,
  type SideTotals,
  type TypeQueryProjectShare,
  type TypeQuerySummary,
  type Violation,
} from './compare-sides.workflow.js'
import { DriverFailure } from './DriverFailure.schema.js'
import { LegScope, type RunScopeName, type ScopeSettings } from './Parity.schema.js'

const ReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-checker-parity/ReportParityOutcome')
type ReportTypeId = typeof ReportTypeId

export class ProjectShard extends S.Class<ProjectShard>('ProjectShard')({ project: S.String, shard: S.Int }) {}

export class CompareFinished extends S.TaggedClass<CompareFinished>()('CompareFinished', {
  decision: ComparisonDecision,
  lineCount: S.Int,
  shards: S.Int,
  summaryFile: S.String,
  projectShards: S.Array(ProjectShard),
  legs: S.Array(LegScope),
}) {}

export class ReportParityOutcomeCommand
  extends S.TaggedClass<ReportParityOutcomeCommand>()('ReportParityOutcomeCommand', {
    outcome: S.Union([CompareFinished, DriverFailure]),
    githubActions: S.Boolean,
    runId: S.String,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const reportFields = {
  stdout: S.Array(S.String),
  stderr: S.Array(S.String),
  annotations: S.Array(S.String),
  stepSummary: S.String,
}

export class ParityHeldReport extends S.TaggedClass<ParityHeldReport>()('ParityHeldReport', {
  exitCode: S.Literal(0),
  ...reportFields,
}) {
  readonly [ReportTypeId] = ReportTypeId
}

export class ParityBrokenReport extends S.TaggedClass<ParityBrokenReport>()('ParityBrokenReport', {
  exitCode: S.Literal(1),
  ...reportFields,
}) {
  readonly [ReportTypeId] = ReportTypeId
}

export class DriverFailedReport extends S.TaggedClass<DriverFailedReport>()('DriverFailedReport', {
  exitCode: S.Literal(2),
  ...reportFields,
}) {
  readonly [ReportTypeId] = ReportTypeId
}

export const ParityOutcomeReport = S.Union([ParityHeldReport, ParityBrokenReport, DriverFailedReport])
export type ParityOutcomeReport = typeof ParityOutcomeReport.Type

const escapeData = (text: string): string => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')

const escapeProperty = (text: string): string => escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C')

const observedText = (observed: ObservedVerdict | null): string =>
  Option.match(Option.fromNullishOr(observed), {
    onNone: () => 'absent',
    onSome: (verdict) => [verdict.status, ...Option.toArray(Option.fromUndefinedOr(verdict.reason))].join(' '),
  })

const describeViolation = (violation: Violation): string =>
  Match.valueTags(violation, {
    VerdictMismatch: (mismatch) =>
      `${mismatch.code} ${mismatch.project} ${mismatch.mutantId} ${mismatch.fileName}:${mismatch.line} main=${
        observedText(mismatch.main)
      } branch=${observedText(mismatch.branch)}`,
    BootAsymmetry: (asymmetry) => `${asymmetry.code} ${asymmetry.project} failed on ${asymmetry.failedSide}`,
    ZeroSnapshotUpdates: (zero) => `${zero.code} ${zero.project}`,
    TelemetryMissingViolation: (missing) =>
      `${missing.code} ${missing.side} ${missing.project} expected ${missing.expectedSpans} received ${missing.receivedSpans}`,
    ZeroShortcuts: (zero) => `${zero.code} ${zero.scope}`,
    SlowerThanMain: (slower) => `${slower.code} branch ${slower.branchMs} ms, main ${slower.mainMs} ms`,
    NothingCompared: (nothing) =>
      `${nothing.code} 0 mutants compared across ${nothing.projectCount} project(s), ${nothing.skippedCount} skipped`,
    WrongNotAssignable: (wrong) =>
      `${wrong.code} ${wrong.project} ${wrong.mutantId} ${wrong.fileName}:${wrong.line} candidate ${
        JSON.stringify(wrong.candidate)
      } (${wrong.candidateType}) not assignable to ${wrong.contextualType} but verdict ${wrong.verdict}`,
    ZeroNotAssignable: (zero) => zero.code,
    UnitOverBudgetViolation: (over) =>
      `${over.code} ${over.side} ${over.project} ${over.fileName} mutants ${over.mutantIds.join(',')}`,
  })

const projectOf = (violation: Violation): Option.Option<string> =>
  Match.valueTags(violation, {
    VerdictMismatch: (mismatch) => Option.some(mismatch.project),
    BootAsymmetry: (asymmetry) => Option.some(asymmetry.project),
    ZeroSnapshotUpdates: (zero) => Option.some(zero.project),
    TelemetryMissingViolation: (missing) => Option.some(missing.project),
    ZeroShortcuts: () => Option.none(),
    SlowerThanMain: () => Option.none(),
    NothingCompared: () => Option.none(),
    WrongNotAssignable: (wrong) => Option.some(wrong.project),
    ZeroNotAssignable: () => Option.none(),
    UnitOverBudgetViolation: (over) => Option.some(over.project),
  })

const locationOf = (violation: Violation): string =>
  Match.valueTags(violation, {
    VerdictMismatch: (mismatch) => `file=${escapeProperty(mismatch.fileName)},line=${mismatch.line},`,
    BootAsymmetry: () => '',
    ZeroSnapshotUpdates: () => '',
    TelemetryMissingViolation: () => '',
    ZeroShortcuts: () => '',
    SlowerThanMain: () => '',
    NothingCompared: () => '',
    WrongNotAssignable: (wrong) => `file=${escapeProperty(wrong.fileName)},line=${wrong.line},`,
    ZeroNotAssignable: () => '',
    UnitOverBudgetViolation: (over) => `file=${escapeProperty(over.fileName)},`,
  })

const shardOf = (finished: CompareFinished, violation: Violation): string =>
  Option.getOrElse(
    Option.flatMap(
      projectOf(violation),
      (project) =>
        Option.map(Arr.findFirst(finished.projectShards, (entry) => entry.project === project), (entry) =>
          String(entry.shard)),
    ),
    () =>
      '<k>',
  )

const annotationOf = (
  command: ReportParityOutcomeCommand,
  finished: CompareFinished,
  group: Arr.NonEmptyReadonlyArray<Violation>,
): string => {
  const first = Arr.headNonEmpty(group)
  const shard = shardOf(finished, first)
  return `::error ${locationOf(first)}title=${escapeProperty(`checker-parity ${first.code}`)}::${
    escapeData(
      `${group.length} ${first.code} violation(s); first: ${
        describeViolation(first)
      }. Next action: ${first.nextAction} (all of them: artifact checker-parity-summary-${command.runId}, file ${finished.summaryFile}; raw lines: artifact checker-parity-${command.runId}-${shard}, file shard-${shard}.ndjson)`,
    )
  }`
}

const groupsByCode = (violations: ReadonlyArray<Violation>): ReadonlyArray<Arr.NonEmptyReadonlyArray<Violation>> =>
  Arr.getSomes(
    Arr.dedupe(violations.map((violation) => violation.code)).map((code) =>
      Arr.match(violations.filter((violation) => violation.code === code), {
        onEmpty: () => Option.none(),
        onNonEmpty: Option.some,
      })
    ),
  )

const ratiosOf = (side: SideTotals): string =>
  `${side.mutants} mutants, ${side.checkCalls} check calls, ${side.phaseMs} ms, ${
    side.snapshotUpdatesPerMutant.toFixed(3)
  } updates/mutant (${Boolean.match(side.countsDerived, { onTrue: () => 'derived', onFalse: () => 'observed' })}), ${
    side.emitBuildsPerMutant.toFixed(3)
  } emit builds/mutant`

const codesSuffix = (violations: ReadonlyArray<Violation>): string =>
  Arr.match(Arr.dedupe(violations.map((violation) => violation.code)), {
    onEmpty: () => '',
    onNonEmpty: (codes) => ` (${codes.join(', ')})`,
  })

const inActions = (
  command: ReportParityOutcomeCommand,
  annotations: () => ReadonlyArray<string>,
): ReadonlyArray<string> => Boolean.match(command.githubActions, { onTrue: annotations, onFalse: () => [] })

const sumLegs = (legs: ReadonlyArray<LegScope>, field: (leg: LegScope) => number): number =>
  legs.reduce((total, leg) => total + field(leg), 0)

const maxLegs = (legs: ReadonlyArray<LegScope>, field: (leg: LegScope) => number): number =>
  legs.reduce((highest, leg) => Num.max(highest, field(leg)), 0)

const SCOPE_TITLES: Readonly<Record<RunScopeName, string>> = { pr: 'pull request', full: 'full corpus' }

const settingsText = (settings: ScopeSettings | null): string =>
  Option.match(Option.fromNullishOr(settings), {
    onNone: () => '',
    onSome: (limits) =>
      ` (seed \`${limits.seed}\`; drift ${limits.perProject} per project over ${limits.driftProjects} project(s); at most ${limits.perChangedFile} per changed file)`,
  })

const scopeLinesOf = (legs: ReadonlyArray<LegScope>, first: LegScope): ReadonlyArray<string> => [
  `- scope: ${SCOPE_TITLES[first.scope]}, ${sumLegs(legs, (leg) => leg.checkedMutants)} mutants checked: ${
    sumLegs(legs, (leg) => leg.changedMutants)
  } in ${sumLegs(legs, (leg) => leg.changedFiles)} changed file(s), ${
    sumLegs(legs, (leg) => leg.sampledMutants)
  } drift sample${settingsText(first.settings)}`,
  `- verdict cache: ${sumLegs(legs, (leg) => leg.cachedFiles)} file(s) reused, ${
    sumLegs(legs, (leg) => leg.freshFiles)
  } checked fresh`,
  `- slowest leg: ${(maxLegs(legs, (leg) => leg.wallMs) / 1000).toFixed(0)} s driver wall time`,
]

const scopeLines = (legs: ReadonlyArray<LegScope>): ReadonlyArray<string> =>
  Option.match(Arr.head(legs), { onNone: () => [], onSome: (first) => scopeLinesOf(legs, first) })

const unknownReasonsText = (share: TypeQueryProjectShare): string =>
  Arr.match(Object.entries(share.unknownReasons).filter(([, count]) => count > 0), {
    onEmpty: () => '',
    onNonEmpty: (reasons) => ` (${reasons.map(([reason, count]) => `${reason} ${count}`).join(', ')})`,
  })

const typeQueryProjectLine = (share: TypeQueryProjectShare): string =>
  `  - ${share.project}: ${share.queried} answered, ${share.notAssignable} NotAssignable, ${share.unknown} Unknown${
    unknownReasonsText(share)
  }, ${share.refusedFiles} file(s) refused (${share.refusedMutants} mutants)${
    Boolean.match(share.queried === 0, { onTrue: () => ' - no answers', onFalse: () => '' })
  }`

const typeQueryLines = (typeQuery: TypeQuerySummary): ReadonlyArray<string> => [
  `- type query: ${typeQuery.queried} answered (${typeQuery.answers.assignable} Assignable, ${typeQuery.answers.notAssignable} NotAssignable, ${typeQuery.answers.unknown} Unknown), ${typeQuery.refusedFiles} file(s) refused, peak ${typeQuery.peakServers} server(s)`,
  ...typeQuery.projects.map(typeQueryProjectLine),
]

const summaryMarkdown = (
  verdict: 'FAIL' | 'pass',
  finished: CompareFinished,
  violations: ReadonlyArray<Violation>,
): string => {
  const summary = finished.decision.summary
  return [
    `### checker-parity: ${verdict}`,
    '',
    `- violations: ${violations.length}${codesSuffix(violations)}`,
    ...scopeLines(finished.legs),
    `- projects: ${summary.measuredProjectCount} measured of ${summary.projectCount}, ${summary.excludedCachedProjectCount} cached-excluded, ${summary.skipped.length} skipped`,
    `- main: ${ratiosOf(summary.main)}`,
    `- branch: ${ratiosOf(summary.branch)}`,
    `- shortcuts: ${summary.shortcutCount.overall} overall, ${summary.shortcutCount.isolatedDeclarations} on the isolatedDeclarations fixture`,
    ...typeQueryLines(summary.typeQuery),
    '',
  ].join('\n')
}

const heldReport = (finished: CompareFinished): ParityHeldReport =>
  ParityHeldReport.make({
    exitCode: 0,
    stdout: [`parity holds over ${finished.lineCount} lines across ${finished.shards} shards`],
    stderr: [],
    annotations: [],
    stepSummary: summaryMarkdown('pass', finished, []),
  })

const brokenReport = (
  command: ReportParityOutcomeCommand,
  finished: CompareFinished,
  broken: ParityBroken,
): ParityBrokenReport =>
  ParityBrokenReport.make({
    exitCode: 1,
    stdout: [
      ...broken.displayed.map((violation) => `${describeViolation(violation)} Next action: ${violation.nextAction}`),
      ...Boolean.match(broken.omittedCount > 0, {
        onTrue: () => [`${broken.omittedCount} more in ${finished.summaryFile}`],
        onFalse: () => [],
      }),
    ],
    stderr: [],
    annotations: inActions(
      command,
      () => groupsByCode(broken.violations).map((group) => annotationOf(command, finished, group)),
    ),
    stepSummary: summaryMarkdown('FAIL', finished, broken.violations),
  })

const failedReport = (command: ReportParityOutcomeCommand, failure: DriverFailure): DriverFailedReport =>
  DriverFailedReport.make({
    exitCode: 2,
    stdout: [],
    stderr: [`${failure.code}: ${failure.reason}`, `next action: ${failure.nextAction}`],
    annotations: inActions(command, () => [
      `::error title=${escapeProperty(`checker-parity ${failure.code}`)}::${
        escapeData(`${failure.reason} Next action: ${failure.nextAction}`)
      }`,
    ]),
    stepSummary:
      `### checker-parity: ERROR (${failure.code})\n\n${failure.reason}\n\nNext action: ${failure.nextAction}\n`,
  })

const reportOf = (command: ReportParityOutcomeCommand): ParityOutcomeReport =>
  Match.valueTags(command.outcome, {
    DriverFailure: (failure) => failedReport(command, failure),
    CompareFinished: (finished) =>
      Match.valueTags(finished.decision, {
        ParityHolds: () => heldReport(finished),
        ParityBroken: (broken) => brokenReport(command, finished, broken),
      }),
  })

export const reportParityOutcome = Workflow.make({
  command: ReportParityOutcomeCommand,
  decision: ParityOutcomeReport,
  error: S.Never,
  decide: (command: ReportParityOutcomeCommand): Result.Result<ParityOutcomeReport, never> =>
    Result.succeed(reportOf(command)),
})
