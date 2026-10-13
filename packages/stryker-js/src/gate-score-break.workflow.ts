import { Workflow } from '@systemfsoftware/effect-cell-types'
import { type Mutant, type Plugin, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const SCORE_BREAK_CODE = 'score-below-break' satisfies Mutant.RunFailureCode
const SCORE_BREAK_EXIT_CLASS = 'VerdictFail' satisfies Plugin.ExitClass
const SCORE_BREAK_REMEDIATION =
  'kill the survivors the report lists, or lower `thresholds.break` (null turns this verdict off)'

export const ProjectThresholds = S.Union([
  S.TaggedStruct('Recorded', { break: S.NullOr(Report.Percentage) }),
  S.TaggedStruct('Unrecorded', {}),
])
export type ProjectThresholds = typeof ProjectThresholds.Type

export const ProjectScore = S.Struct({
  project: S.String,
  score: Report.MutationScore,
  thresholds: ProjectThresholds,
})
export type ProjectScore = typeof ProjectScore.Type

export const BreakBreach = S.Struct({
  project: S.String,
  percentage: Report.Percentage,
  threshold: Report.Percentage,
})
export type BreakBreach = typeof BreakBreach.Type

export class GateScoreBreakCommand extends S.TaggedClass<GateScoreBreakCommand>()('GateScoreBreakCommand', {
  projects: S.Array(ProjectScore),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const GateScoreBreakTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/GateScoreBreakDecision')
type GateScoreBreakTypeId = typeof GateScoreBreakTypeId

const notesOf = (unscored: ReadonlyArray<string>, unrecorded: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...unscored.map((project) =>
    `stryker gate: ${project} tested no valid mutant, so there is no mutation score to hold against thresholds.break`
  ),
  ...unrecorded.map((project) =>
    `stryker gate: ${project}: no thresholds recorded for this project; re-run its shards with the project's config`
  ),
]

export class ScoreAtOrAboveBreak extends S.TaggedClass<ScoreAtOrAboveBreak>()('ScoreAtOrAboveBreak', {
  unscored: S.Array(S.String),
  unrecorded: S.Array(S.String),
}) {
  readonly [GateScoreBreakTypeId] = GateScoreBreakTypeId

  get lines(): ReadonlyArray<string> {
    return notesOf(this.unscored, this.unrecorded)
  }
}

export const GateScoreBreakDecision = S.Union([ScoreAtOrAboveBreak])
export type GateScoreBreakDecision = typeof GateScoreBreakDecision.Type

export class ScoreBelowBreak extends S.TaggedError<ScoreBelowBreak>()('ScoreBelowBreak', {
  breaches: S.NonEmptyArray(BreakBreach),
  projects: S.Int,
  unscored: S.Array(S.String),
  unrecorded: S.Array(S.String),
}) {
  readonly code = SCORE_BREAK_CODE
  readonly exitClass = SCORE_BREAK_EXIT_CLASS

  get lines(): ReadonlyArray<string> {
    return [
      ...this.breaches.map((breach) =>
        `  ${SCORE_BREAK_CODE}: ${breach.project} scored ${breach.percentage.toFixed(2)} < break ${
          String(breach.threshold)
        }`
      ),
      ...notesOf(this.unscored, this.unrecorded),
      SCORE_BREAK_REMEDIATION,
    ]
  }

  override get message(): string {
    return [
      `stryker gate: ${this.breaches.length} of ${this.projects} project(s) scored below thresholds.break`,
      ...this.lines,
    ].join('\n')
  }
}

const breakOf = (entry: ProjectScore): number | null =>
  Match.valueTags(entry.thresholds, {
    Recorded: ({ break: threshold }) => threshold,
    Unrecorded: () => null,
  })

const breachOf = (entry: ProjectScore): Option.Option<BreakBreach> =>
  Match.valueTags(entry.score, {
    Unscored: () => Option.none(),
    Scored: ({ percentage }) =>
      Option.map(
        Option.fromNullishOr(breakOf(entry)),
        (threshold): BreakBreach => ({ project: entry.project, percentage, threshold }),
      ),
  })

const isBelowItsBreak = (breach: BreakBreach): boolean => breach.percentage < breach.threshold

const breachesOf = (projects: ReadonlyArray<ProjectScore>): ReadonlyArray<BreakBreach> =>
  Arr.flatMap(projects, (entry) => Option.toArray(Option.filter(breachOf(entry), isBelowItsBreak)))

const isUnscoredWithBreak = (entry: ProjectScore): boolean =>
  Match.valueTags(entry.score, { Unscored: () => breakOf(entry) !== null, Scored: () => false })

const isUnrecorded = (entry: ProjectScore): boolean =>
  Match.valueTags(entry.thresholds, { Recorded: () => false, Unrecorded: () => true })

const projectsWhere = (
  projects: ReadonlyArray<ProjectScore>,
  predicate: (entry: ProjectScore) => boolean,
): ReadonlyArray<string> => Arr.map(Arr.filter(projects, predicate), (entry) => entry.project)

const decide = (command: GateScoreBreakCommand): Result.Result<GateScoreBreakDecision, ScoreBelowBreak> => {
  const unscored = projectsWhere(command.projects, isUnscoredWithBreak)
  const unrecorded = projectsWhere(command.projects, isUnrecorded)
  return Option.match(Arr.match(breachesOf(command.projects), { onEmpty: Option.none, onNonEmpty: Option.some }), {
    onNone: () => Result.succeed(ScoreAtOrAboveBreak.make({ unscored, unrecorded })),
    onSome: (breaches) =>
      Result.fail(ScoreBelowBreak.make({ breaches, projects: command.projects.length, unscored, unrecorded })),
  })
}

export const gateScoreBreak = Workflow.make({
  command: GateScoreBreakCommand,
  decision: GateScoreBreakDecision,
  error: ScoreBelowBreak,
  decide,
})
