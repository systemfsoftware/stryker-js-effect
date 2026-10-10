import { Workflow } from '@systemfsoftware/effect-cell-types'
import { type Mutant, type Plugin, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { classifyExit, ClassifyExitCommand, ExitVerdictFailed } from './classify-exit.workflow.js'

const SCORE_BREAK_CODE = 'score-below-break' satisfies Mutant.RunFailureCode
const SCORE_BREAK_EXIT_CLASS = 'VerdictFail' satisfies Plugin.ExitClass
const SCORE_BREAK_REMEDIATION =
  'kill the survivors the report lists, or lower `thresholds.break` (null turns this verdict off)'

export const ProjectThresholds = S.Struct({ break: S.NullOr(Report.Percentage) })
export type ProjectThresholds = typeof ProjectThresholds.Type

export const ProjectScore = S.Struct({
  project: S.String,
  score: Report.MutationScore,
  thresholds: S.NullOr(ProjectThresholds),
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

  override get message(): string {
    return [
      `stryker gate: ${this.breaches.length} of ${this.projects} project(s) scored below thresholds.break`,
      ...this.breaches.map((breach) =>
        `  ${SCORE_BREAK_CODE}: ${breach.project} scored ${breach.percentage.toFixed(2)} < break ${
          String(breach.threshold)
        }`
      ),
      ...notesOf(this.unscored, this.unrecorded),
      SCORE_BREAK_REMEDIATION,
    ].join('\n')
  }
}

const exitOf = classifyExit
const exitCommand = ClassifyExitCommand
const isVerdictFailed = S.is(ExitVerdictFailed)

const breakOf = (entry: ProjectScore): number | null =>
  Option.getOrNull(Option.flatMapNullishOr(Option.fromNullishOr(entry.thresholds), (thresholds) => thresholds.break))

const failsBreak = (entry: ProjectScore): boolean =>
  Result.match(
    exitOf(exitCommand.make({ pending: [], score: entry.score, breakingThreshold: breakOf(entry) })),
    { onFailure: (neverError) => neverError, onSuccess: isVerdictFailed },
  )

const breachOf = (entry: ProjectScore): Option.Option<BreakBreach> =>
  Match.valueTags(entry.score, {
    Unscored: () => Option.none(),
    Scored: ({ percentage }) =>
      Option.map(
        Option.fromNullishOr(breakOf(entry)),
        (threshold): BreakBreach => ({ project: entry.project, percentage, threshold }),
      ),
  })

const breachesOf = (projects: ReadonlyArray<ProjectScore>): ReadonlyArray<BreakBreach> =>
  Arr.flatMap(projects, (entry) => Option.toArray(Option.filter(breachOf(entry), () => failsBreak(entry))))

const isUnscoredWithBreak = (entry: ProjectScore): boolean =>
  Match.valueTags(entry.score, { Unscored: () => breakOf(entry) !== null, Scored: () => false })

const projectsWhere = (
  projects: ReadonlyArray<ProjectScore>,
  predicate: (entry: ProjectScore) => boolean,
): ReadonlyArray<string> => Arr.map(Arr.filter(projects, predicate), (entry) => entry.project)

const decide = (command: GateScoreBreakCommand): Result.Result<GateScoreBreakDecision, ScoreBelowBreak> => {
  const unscored = projectsWhere(command.projects, isUnscoredWithBreak)
  const unrecorded = projectsWhere(command.projects, (entry) => entry.thresholds === null)
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
