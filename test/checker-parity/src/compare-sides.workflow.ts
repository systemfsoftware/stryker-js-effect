import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  CheckCall,
  Counts,
  Gates,
  ParityLine,
  PhaseLine,
  ProjectBootFailed,
  ProjectSkipped,
  Side,
  TelemetryMissing,
  Verdict,
  VerdictStatus,
} from './Parity.schema.js'

const SCHEMA_VERSION = S.Literal(1)
const DISPLAY_LIMIT = 50

export const ObservedVerdict = S.Struct({
  status: VerdictStatus,
  reason: S.optional(S.String),
})
export type ObservedVerdict = typeof ObservedVerdict.Type

export class VerdictMismatch extends S.TaggedClass<VerdictMismatch>()('VerdictMismatch', {
  schemaVersion: SCHEMA_VERSION,
  code: S.Literal('verdict-mismatch'),
  nextAction: S.String,
  project: S.String,
  mutantId: S.String,
  fileName: S.String,
  line: S.Int,
  main: S.NullOr(ObservedVerdict),
  branch: S.NullOr(ObservedVerdict),
}) {}

export class BootAsymmetry extends S.TaggedClass<BootAsymmetry>()('BootAsymmetry', {
  schemaVersion: SCHEMA_VERSION,
  code: S.Literal('boot-asymmetry'),
  nextAction: S.String,
  project: S.String,
  failedSide: Side,
}) {}

export class ZeroSnapshotUpdates extends S.TaggedClass<ZeroSnapshotUpdates>()('ZeroSnapshotUpdates', {
  schemaVersion: SCHEMA_VERSION,
  code: S.Literal('zero-snapshot-updates'),
  nextAction: S.String,
  project: S.String,
}) {}

export class TelemetryMissingViolation extends S.TaggedClass<TelemetryMissingViolation>()(
  'TelemetryMissingViolation',
  {
    schemaVersion: SCHEMA_VERSION,
    code: S.Literal('telemetry-missing'),
    nextAction: S.String,
    side: Side,
    project: S.String,
    expectedSpans: S.Int,
    receivedSpans: S.Int,
  },
) {}

export class ZeroShortcuts extends S.TaggedClass<ZeroShortcuts>()('ZeroShortcuts', {
  schemaVersion: SCHEMA_VERSION,
  code: S.Literal('zero-shortcuts'),
  nextAction: S.String,
  scope: S.Literals(['overall', 'isolatedDeclarations']),
}) {}

export class SlowerThanMain extends S.TaggedClass<SlowerThanMain>()('SlowerThanMain', {
  schemaVersion: SCHEMA_VERSION,
  code: S.Literal('slower-than-main'),
  nextAction: S.String,
  branchMs: S.Finite,
  mainMs: S.Finite,
}) {}

export class NothingCompared extends S.TaggedClass<NothingCompared>()('NothingCompared', {
  schemaVersion: SCHEMA_VERSION,
  code: S.Literal('nothing-compared'),
  nextAction: S.String,
  projectCount: S.Int,
  skippedCount: S.Int,
}) {}

export const Violation = S.Union([
  VerdictMismatch,
  BootAsymmetry,
  ZeroSnapshotUpdates,
  TelemetryMissingViolation,
  ZeroShortcuts,
  SlowerThanMain,
  NothingCompared,
])
export type Violation = typeof Violation.Type

export const SideTotals = S.Struct({
  side: Side,
  mutants: S.Int,
  checkCalls: S.Int,
  phaseMs: S.Finite,
  snapshotUpdates: S.Int,
  emitBuilds: S.Int,
  snapshotUpdatesPerMutant: S.Finite,
  emitBuildsPerMutant: S.Finite,
  countsDerived: S.Boolean,
})
export type SideTotals = typeof SideTotals.Type

export const SkippedProject = S.Struct({ project: S.String, reason: S.String })
export type SkippedProject = typeof SkippedProject.Type

export const ShortcutCounts = S.Struct({ overall: S.Int, isolatedDeclarations: S.Int })
export type ShortcutCounts = typeof ShortcutCounts.Type

export const ComparisonSummary = S.Struct({
  schemaVersion: SCHEMA_VERSION,
  projectCount: S.Int,
  measuredProjectCount: S.Int,
  excludedCachedProjectCount: S.Int,
  skipped: S.Array(SkippedProject),
  main: SideTotals,
  branch: SideTotals,
  shortcutCount: ShortcutCounts,
})
export type ComparisonSummary = typeof ComparisonSummary.Type

const ComparisonTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-checker-parity/CompareSides')
type ComparisonTypeId = typeof ComparisonTypeId

export class ParityHolds extends S.TaggedClass<ParityHolds>()('ParityHolds', {
  schemaVersion: SCHEMA_VERSION,
  summary: ComparisonSummary,
}) {
  readonly [ComparisonTypeId] = ComparisonTypeId
}

export class ParityBroken extends S.TaggedClass<ParityBroken>()('ParityBroken', {
  schemaVersion: SCHEMA_VERSION,
  violations: S.Array(Violation),
  displayed: S.Array(Violation),
  omittedCount: S.Int,
  summary: ComparisonSummary,
}) {
  readonly [ComparisonTypeId] = ComparisonTypeId
}

export const ComparisonDecision = S.Union([ParityHolds, ParityBroken])
export type ComparisonDecision = typeof ComparisonDecision.Type

export class CompareSidesCommand extends S.TaggedClass<CompareSidesCommand>()('CompareSidesCommand', {
  lines: S.Array(ParityLine),
  gates: Gates,
  isolatedDeclarationsProject: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const isVerdict = S.is(Verdict)
const isCheckCall = S.is(CheckCall)
const isCounts = S.is(Counts)
const isBootFailure = S.is(ProjectBootFailed)
const isProjectSkipped = S.is(ProjectSkipped)
const isTelemetryMissing = S.is(TelemetryMissing)

const isPhaseLine = S.is(PhaseLine)

const cachedVerdictFlag = (line: ParityLine): boolean =>
  Option.exists(Option.filter(Option.some(line), isVerdict), (verdict) => verdict.cached)

const cachedPhaseFlag = (line: ParityLine): boolean =>
  Option.exists(Option.filter(Option.some(line), isPhaseLine), (phase) => phase.cached)

const isCachedLine = (line: ParityLine): boolean => Boolean.some([cachedVerdictFlag(line), cachedPhaseFlag(line)])

const when = <A>(condition: boolean, value: A): ReadonlyArray<A> =>
  Match.value(condition).pipe(
    Match.when(true, () => [value]),
    Match.when(false, (): ReadonlyArray<A> => []),
    Match.exhaustive,
  )

const projectsOf = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<string> =>
  Arr.dedupe(lines.map((line) => line.project))

const linesOf = (lines: ReadonlyArray<ParityLine>, project: string): ReadonlyArray<ParityLine> =>
  lines.filter((line) => line.project === project)

const verdictsIn = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<Verdict> =>
  lines.filter((line): line is Verdict => isVerdict(line))

const checkCallsIn = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<CheckCall> =>
  lines.filter((line): line is CheckCall => isCheckCall(line))

const countsIn = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<Counts> =>
  lines.filter((line): line is Counts => isCounts(line))

const verdictsOf = (
  lines: ReadonlyArray<ParityLine>,
  project: string,
  side: Side,
): ReadonlyArray<Verdict> =>
  verdictsIn(lines).filter((verdict) => Boolean.every([verdict.project === project, verdict.side === side]))

const phaseLinesIn = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<PhaseLine> =>
  lines.filter((line): line is PhaseLine => isPhaseLine(line))

const phaseLinesOf = (
  lines: ReadonlyArray<ParityLine>,
  project: string,
  side: Side,
): ReadonlyArray<PhaseLine> =>
  phaseLinesIn(lines).filter((line) => Boolean.every([line.project === project, line.side === side, !line.cached]))

const phaseMsOf = (lines: ReadonlyArray<ParityLine>, project: string, side: Side): number =>
  phaseLinesOf(lines, project, side).reduce((total, line) => total + line.ms, 0)

const measured = (lines: ReadonlyArray<ParityLine>, project: string, side: Side): boolean =>
  phaseLinesOf(lines, project, side).length > 0

const bootFailuresOf = (
  lines: ReadonlyArray<ParityLine>,
  project: string,
  side: Side,
): ReadonlyArray<ProjectBootFailed> =>
  lines
    .filter((line): line is ProjectBootFailed => isBootFailure(line))
    .filter((failure) => Boolean.every([failure.project === project, failure.side === side]))

const bootFailureOf = (
  lines: ReadonlyArray<ParityLine>,
  project: string,
  side: Side,
): Option.Option<ProjectBootFailed> => Arr.head(bootFailuresOf(lines, project, side))

const branchCounts = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<Counts> =>
  countsIn(lines).filter((counts) => counts.side === 'branch')

const countsOf = (lines: ReadonlyArray<ParityLine>, project: string): ReadonlyArray<Counts> =>
  branchCounts(lines).filter((counts) => counts.project === project)

const sumCounts = (lines: ReadonlyArray<ParityLine>, field: (counts: Counts) => number): number =>
  branchCounts(lines).reduce((total, counts) => total + field(counts), 0)

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const ownPositionOf = (fileName: string): RegExp =>
  new RegExp(`^(?:[^\\n]*/)?${escapeRegExp(fileName)}\\(\\d+,\\d+\\)`, 'u')

const reasonText = (reason: string | undefined): string => Option.getOrElse(Option.fromUndefinedOr(reason), () => '')

const normaliseReason = (reason: string | undefined, fileName: string): string =>
  Arr.join(
    reasonText(reason).split('\n').map((line) => line.replace(ownPositionOf(fileName), () => `${fileName}(*)`)),
    '\n',
  )

const sameVerdict = (main: Verdict, branch: Verdict): boolean =>
  Boolean.every([
    main.status === branch.status,
    normaliseReason(main.reason, main.fileName) === normaliseReason(branch.reason, branch.fileName),
  ])

const bothVerdictsDiffer = (main: Option.Option<Verdict>, branch: Option.Option<Verdict>): boolean =>
  Option.match(main, {
    onNone: () => false,
    onSome: (mainVerdict) =>
      Option.match(branch, {
        onNone: () => false,
        onSome: (branchVerdict) => !sameVerdict(mainVerdict, branchVerdict),
      }),
  })

const observedOf = (verdict: Verdict): ObservedVerdict => ({ status: verdict.status, reason: verdict.reason })

const verdictMismatchNextAction = (project: string, fileName: string): string =>
  `Reproduce locally: run the checker integration test on ${fileName} with importerCheck 'always' and compare reasons; the full rows are in the shard NDJSON for project ${project}.`

const mismatchFor = (
  project: string,
  witness: Verdict,
  main: Option.Option<Verdict>,
  branch: Option.Option<Verdict>,
): Option.Option<VerdictMismatch> => {
  const mutantId = witness.mutantId
  const inScope = Boolean.some([Option.isNone(main), Option.isNone(branch), bothVerdictsDiffer(main, branch)])
  return Option.filter(
    Option.some(
      VerdictMismatch.make({
        schemaVersion: 1,
        code: 'verdict-mismatch',
        nextAction: verdictMismatchNextAction(project, witness.fileName),
        project,
        mutantId,
        fileName: witness.fileName,
        line: witness.line,
        main: Option.match(main, { onNone: () => null, onSome: observedOf }),
        branch: Option.match(branch, { onNone: () => null, onSome: observedOf }),
      }),
    ),
    () => inScope,
  )
}

const verdictIndexOf = (verdicts: ReadonlyArray<Verdict>): (mutantId: string) => Option.Option<Verdict> => {
  const byId = HashMap.fromIterable(verdicts.map((verdict) => [verdict.mutantId, verdict] as const))
  return (mutantId) => HashMap.get(byId, mutantId)
}

const verdictViolationsFor = (lines: ReadonlyArray<ParityLine>, project: string): ReadonlyArray<VerdictMismatch> => {
  const mainVerdicts = verdictsOf(lines, project, 'main')
  const branchVerdicts = verdictsOf(lines, project, 'branch')
  const mainOf = verdictIndexOf(mainVerdicts)
  const branchOf = verdictIndexOf(branchVerdicts)
  const witnesses = Arr.dedupeWith([...branchVerdicts, ...mainVerdicts], (a, b) => a.mutantId === b.mutantId)
  return Arr.getSomes(
    witnesses.map((witness) => mismatchFor(project, witness, mainOf(witness.mutantId), branchOf(witness.mutantId))),
  )
}

const bootNextAction = (failedSide: Side, project: string): string =>
  `Inspect the ${failedSide} worker boot for ${project}: the checker's init runs at boot, so a dry-run failure lands here. Compare the other side's boot log in the shard NDJSON.`

const bootViolationsFor = (lines: ReadonlyArray<ParityLine>, project: string): ReadonlyArray<BootAsymmetry> => {
  const mainFailed = Option.isSome(bootFailureOf(lines, project, 'main'))
  const branchFailed = Option.isSome(bootFailureOf(lines, project, 'branch'))
  return [
    ...when(
      Boolean.every([mainFailed, !branchFailed]),
      BootAsymmetry.make({
        schemaVersion: 1,
        code: 'boot-asymmetry',
        nextAction: bootNextAction('main', project),
        project,
        failedSide: 'main',
      }),
    ),
    ...when(
      Boolean.every([branchFailed, !mainFailed]),
      BootAsymmetry.make({
        schemaVersion: 1,
        code: 'boot-asymmetry',
        nextAction: bootNextAction('branch', project),
        project,
        failedSide: 'branch',
      }),
    ),
  ]
}

const branchCheckedMutants = (lines: ReadonlyArray<ParityLine>, project: string): number =>
  verdictsOf(lines, project, 'branch').filter((verdict) => !verdict.cached).length

const zeroUpdateViolationsFor = (
  lines: ReadonlyArray<ParityLine>,
  project: string,
): ReadonlyArray<ZeroSnapshotUpdates> => {
  const checked = branchCheckedMutants(lines, project) >= 1
  const counts = countsOf(lines, project)
  const updates = counts.reduce((total, line) => total + line.snapshotUpdates, 0)
  const zero = Boolean.some([counts.length === 0, updates === 0])
  return when(
    Boolean.every([checked, zero]),
    ZeroSnapshotUpdates.make({
      schemaVersion: 1,
      code: 'zero-snapshot-updates',
      nextAction:
        `Read the branch Counts for ${project} in the shard NDJSON: snapshotUpdates is 0 or the line is missing. Confirm the typescript.snapshot_updates.count span attribute is exported.`,
      project,
    }),
  )
}

const telemetryViolations = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<TelemetryMissingViolation> =>
  lines.filter((line): line is TelemetryMissing => isTelemetryMissing(line)).map((line) =>
    TelemetryMissingViolation.make({
      schemaVersion: 1,
      code: 'telemetry-missing',
      nextAction:
        `Check the ${line.side} OTLP export for ${line.project}: the driver expected ${line.expectedSpans} check spans and received ${line.receivedSpans}. Confirm OTEL_ENABLED and the exporter endpoint.`,
      side: line.side,
      project: line.project,
      expectedSpans: line.expectedSpans,
      receivedSpans: line.receivedSpans,
    })
  )

const shortcutNextAction = (scope: 'overall' | 'isolatedDeclarations'): string =>
  Match.value(scope).pipe(
    Match.when('overall', () =>
      `Read the branch Counts in the shard NDJSON: no mutant was decided by the importer shortcut; confirm the shortcut is enabled and typescript.importer_shortcut.count is exported.`),
    Match.when('isolatedDeclarations', () =>
      `Read the isolatedDeclarations fixture's branch Counts in the shard NDJSON: its importerShortcuts is 0; the fixture must exercise an importer re-check path.`),
    Match.exhaustive,
  )

const shortcutViolationsFor = (command: CompareSidesCommand): ReadonlyArray<ZeroShortcuts> => {
  const overall = sumCounts(command.lines, (counts) => counts.importerShortcuts)
  const isolatedDeclarations = sumCounts(
    command.lines.filter((counts) => counts.project === command.isolatedDeclarationsProject),
    (counts) => counts.importerShortcuts,
  )
  return [
    ...when(
      Boolean.every([command.gates.shortcutCount, overall === 0]),
      ZeroShortcuts.make({
        schemaVersion: 1,
        code: 'zero-shortcuts',
        nextAction: shortcutNextAction('overall'),
        scope: 'overall',
      }),
    ),
    ...when(
      Boolean.every([command.gates.shortcutCount, isolatedDeclarations === 0]),
      ZeroShortcuts.make({
        schemaVersion: 1,
        code: 'zero-shortcuts',
        nextAction: shortcutNextAction('isolatedDeclarations'),
        scope: 'isolatedDeclarations',
      }),
    ),
  ]
}

const measuredOnBoth = (lines: ReadonlyArray<ParityLine>, projects: ReadonlyArray<string>): ReadonlyArray<string> =>
  projects.filter((project) => Boolean.every([measured(lines, project, 'main'), measured(lines, project, 'branch')]))

const speedSum = (
  lines: ReadonlyArray<ParityLine>,
  projects: ReadonlyArray<string>,
  side: Side,
): number => projects.reduce((total, project) => total + phaseMsOf(lines, project, side), 0)

const speedViolationsFor = (command: CompareSidesCommand): ReadonlyArray<SlowerThanMain> => {
  const compared = measuredOnBoth(command.lines, projectsOf(command.lines))
  const mainMs = speedSum(command.lines, compared, 'main')
  const branchMs = speedSum(command.lines, compared, 'branch')
  return when(
    Boolean.every([command.gates.speed, compared.length > 0, branchMs >= mainMs]),
    SlowerThanMain.make({
      schemaVersion: 1,
      code: 'slower-than-main',
      nextAction:
        `Compare the phase lines for projects measured on both sides in the shard NDJSON: branch ${branchMs} ms is not strictly below main ${mainMs} ms. Profile the branch checker's check phase.`,
      branchMs,
      mainMs,
    }),
  )
}

const nonCachedCheckCalls = (lines: ReadonlyArray<ParityLine>, project: string, side: Side): number =>
  checkCallsIn(lines).filter((call) => Boolean.every([call.project === project, call.side === side, !call.cached]))
    .length

const nonCachedVerdicts = (lines: ReadonlyArray<ParityLine>, project: string, side: Side): number =>
  verdictsIn(lines).filter((verdict) =>
    Boolean.every([verdict.project === project, verdict.side === side, !verdict.cached])
  )
    .length

const derivedMainUpdates = (lines: ReadonlyArray<ParityLine>, projects: ReadonlyArray<string>): number =>
  projects.reduce(
    (total, project) =>
      total + nonCachedCheckCalls(lines, project, 'main') + nonCachedVerdicts(lines, project, 'main') +
      countsOf(lines, project).reduce((sum, counts) => sum + counts.resplices, 0),
    0,
  )

const callFileKeys = (
  call: CheckCall,
  passingOf: (mutantId: string) => Option.Option<Verdict>,
): ReadonlyArray<string> =>
  Arr.getSomes(
    call.mutantIds.map((mutantId) =>
      Option.map(passingOf(mutantId), (verdict) => `${call.callIndex}\u0000${verdict.fileName}`)
    ),
  )

const passingVerdictsOf = (lines: ReadonlyArray<ParityLine>, project: string): ReadonlyArray<Verdict> =>
  verdictsOf(lines, project, 'main').filter((verdict) => verdict.status === 'passed')

const checkCallsOf = (lines: ReadonlyArray<ParityLine>, project: string, side: Side): ReadonlyArray<CheckCall> =>
  checkCallsIn(lines).filter((call) => Boolean.every([call.project === project, call.side === side]))

const emitBuildKeysOf = (lines: ReadonlyArray<ParityLine>, project: string): ReadonlyArray<string> => {
  const passingOf = verdictIndexOf(passingVerdictsOf(lines, project))
  return checkCallsOf(lines, project, 'main').flatMap((call) => callFileKeys(call, passingOf))
}

const derivedMainEmitBuilds = (lines: ReadonlyArray<ParityLine>, projects: ReadonlyArray<string>): number =>
  projects.reduce((total, project) => total + Arr.dedupe(emitBuildKeysOf(lines, project)).length, 0)

const mutatedCount = (lines: ReadonlyArray<ParityLine>, side: Side): number =>
  verdictsIn(lines).filter((verdict) => verdict.side === side).length

const checkCallCount = (lines: ReadonlyArray<ParityLine>, side: Side): number =>
  checkCallsIn(lines).filter((call) => call.side === side).length

const perMutant = (value: number, mutants: number): number =>
  Option.match(Option.filter(Option.some(mutants), (count) => count > 0), {
    onNone: () => 0,
    onSome: (count) => value / count,
  })

const sideTotals = (
  lines: ReadonlyArray<ParityLine>,
  projects: ReadonlyArray<string>,
  measuredProjects: ReadonlyArray<string>,
  side: Side,
): SideTotals => {
  const mutants = mutatedCount(lines, side)
  const snapshotUpdates = Match.value(side).pipe(
    Match.when('branch', () => sumCounts(lines, (counts) => counts.snapshotUpdates)),
    Match.when('main', () => derivedMainUpdates(lines, projects)),
    Match.exhaustive,
  )
  const emitBuilds = Match.value(side).pipe(
    Match.when('branch', () => sumCounts(lines, (counts) => counts.tceBuilds)),
    Match.when('main', () => derivedMainEmitBuilds(lines, projects)),
    Match.exhaustive,
  )
  return {
    side,
    mutants,
    checkCalls: checkCallCount(lines, side),
    phaseMs: speedSum(lines, measuredProjects, side),
    snapshotUpdates,
    emitBuilds,
    snapshotUpdatesPerMutant: perMutant(snapshotUpdates, mutants),
    emitBuildsPerMutant: perMutant(emitBuilds, mutants),
    countsDerived: side === 'main',
  }
}

const bootReasonsOf = (lines: ReadonlyArray<ParityLine>, project: string): ReadonlyArray<string> =>
  (['main', 'branch'] as const).flatMap((side) =>
    Arr.getSomes([
      Option.map(bootFailureOf(lines, project, side), (failure) => `${side}: ${failure.reason}`),
    ])
  )

const skippedLineEntries = (lines: ReadonlyArray<ParityLine>): ReadonlyArray<SkippedProject> =>
  lines.filter((line): line is ProjectSkipped => isProjectSkipped(line))
    .filter((line) => linesOf(lines, line.project).every(isProjectSkipped))
    .map((line) => ({ project: line.project, reason: line.reason }))

const dedupeByProject = (entries: ReadonlyArray<SkippedProject>): ReadonlyArray<SkippedProject> => {
  const lastByProject = HashMap.fromIterable(entries.map((entry) => [entry.project, entry] as const))
  return Arr.getSomes(
    Arr.dedupe(entries.map((entry) => entry.project)).map((project) => HashMap.get(lastByProject, project)),
  )
}

const skippedProjects = (
  lines: ReadonlyArray<ParityLine>,
  projects: ReadonlyArray<string>,
): ReadonlyArray<SkippedProject> => {
  const bootBoth = Arr.getSomes(
    projects.map((project) =>
      Option.map(
        Option.filter(Option.some(bootReasonsOf(lines, project)), (reasons) => reasons.length === 2),
        (reasons) => ({ project, reason: reasons.join('; ') }),
      )
    ),
  )
  return dedupeByProject([...bootBoth, ...skippedLineEntries(lines)])
}

const excludedCachedProjectCount = (lines: ReadonlyArray<ParityLine>, projects: ReadonlyArray<string>): number =>
  projects.filter((project) => linesOf(lines, project).some(isCachedLine)).length

const summaryOf = (command: CompareSidesCommand): ComparisonSummary => {
  const projects = projectsOf(command.lines)
  const measuredProjects = measuredOnBoth(command.lines, projects)
  return {
    schemaVersion: 1,
    projectCount: projects.length,
    measuredProjectCount: measuredProjects.length,
    excludedCachedProjectCount: excludedCachedProjectCount(command.lines, projects),
    skipped: skippedProjects(command.lines, projects),
    main: sideTotals(command.lines, projects, measuredProjects, 'main'),
    branch: sideTotals(command.lines, projects, measuredProjects, 'branch'),
    shortcutCount: {
      overall: sumCounts(command.lines, (counts) => counts.importerShortcuts),
      isolatedDeclarations: sumCounts(
        command.lines.filter((counts) => counts.project === command.isolatedDeclarationsProject),
        (counts) => counts.importerShortcuts,
      ),
    },
  }
}

const bootFailedEither = (lines: ReadonlyArray<ParityLine>, project: string): boolean =>
  Boolean.some([
    Option.isSome(bootFailureOf(lines, project, 'main')),
    Option.isSome(bootFailureOf(lines, project, 'branch')),
  ])

const comparedMutantCount = (lines: ReadonlyArray<ParityLine>, projects: ReadonlyArray<string>): number =>
  projects.filter((project) => !bootFailedEither(lines, project)).flatMap((project) =>
    Arr.dedupe(
      [...verdictsOf(lines, project, 'main'), ...verdictsOf(lines, project, 'branch')].map((verdict) =>
        verdict.mutantId
      ),
    )
  ).length

const nothingComparedViolations = (
  lines: ReadonlyArray<ParityLine>,
  projects: ReadonlyArray<string>,
): ReadonlyArray<NothingCompared> =>
  when(
    comparedMutantCount(lines, projects) === 0,
    NothingCompared.make({
      schemaVersion: 1,
      code: 'nothing-compared',
      nextAction:
        'No mutant reached both checkers: read the skipped projects in the summary artifact (boot failures, empty shards) and fix the corpus or worker boot before trusting the lane.',
      projectCount: projects.length,
      skippedCount: skippedProjects(lines, projects).length,
    }),
  )

const violationsOf = (command: CompareSidesCommand): ReadonlyArray<Violation> => {
  const projects = projectsOf(command.lines)
  return [
    ...projects.flatMap((project) =>
      when(!bootFailedEither(command.lines, project), verdictViolationsFor(command.lines, project)).flat()
    ),
    ...projects.flatMap((project) => bootViolationsFor(command.lines, project)),
    ...projects.flatMap((project) => zeroUpdateViolationsFor(command.lines, project)),
    ...telemetryViolations(command.lines),
    ...shortcutViolationsFor(command),
    ...speedViolationsFor(command),
    ...nothingComparedViolations(command.lines, projects),
  ]
}

const comparisonOf = (command: CompareSidesCommand): ComparisonDecision => {
  const summary = summaryOf(command)
  const violations = violationsOf(command)
  const displayed = violations.slice(0, DISPLAY_LIMIT)
  const omittedCount = violations.length - displayed.length
  return Match.value(violations.length === 0).pipe(
    Match.when(true, () => ParityHolds.make({ schemaVersion: 1, summary })),
    Match.when(false, () => ParityBroken.make({ schemaVersion: 1, violations, displayed, omittedCount, summary })),
    Match.exhaustive,
  )
}

export const compareSides = Workflow.make({
  command: CompareSidesCommand,
  decision: ComparisonDecision,
  error: S.Never,
  decide: (command: CompareSidesCommand): Result.Result<ComparisonDecision, never> =>
    Result.succeed(comparisonOf(command)),
})
