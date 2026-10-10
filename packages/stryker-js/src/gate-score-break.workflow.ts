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

export const ProjectScore = S.Struct({
  project: S.String,
  score: Report.MutationScore,
  breakingThreshold: S.NullOr(Report.Percentage),
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

export class ScoreAtOrAboveBreak extends S.TaggedClass<ScoreAtOrAboveBreak>()('ScoreAtOrAboveBreak', {
  unscored: S.Array(S.String),
}) {
  readonly [GateScoreBreakTypeId] = GateScoreBreakTypeId
}

export const GateScoreBreakDecision = S.Union([ScoreAtOrAboveBreak])
export type GateScoreBreakDecision = typeof GateScoreBreakDecision.Type

export class ScoreBelowBreak extends S.TaggedError<ScoreBelowBreak>()('ScoreBelowBreak', {
  breaches: S.NonEmptyArray(BreakBreach),
  projects: S.Int,
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
      SCORE_BREAK_REMEDIATION,
    ].join('\n')
  }
}

const exitOf = classifyExit
const exitCommand = ClassifyExitCommand
const isVerdictFailed = S.is(ExitVerdictFailed)

const failsBreak = (entry: ProjectScore): boolean =>
  Result.match(
    exitOf(exitCommand.make({ pending: [], score: entry.score, breakingThreshold: entry.breakingThreshold })),
    { onFailure: (neverError) => neverError, onSuccess: isVerdictFailed },
  )

const breachOf = (entry: ProjectScore): Option.Option<BreakBreach> =>
  Match.valueTags(entry.score, {
    Unscored: () => Option.none(),
    Scored: ({ percentage }) =>
      Option.map(
        Option.fromNullishOr(entry.breakingThreshold),
        (threshold): BreakBreach => ({ project: entry.project, percentage, threshold }),
      ),
  })

const breachesOf = (projects: ReadonlyArray<ProjectScore>): ReadonlyArray<BreakBreach> =>
  Arr.flatMap(projects, (entry) => Option.toArray(Option.filter(breachOf(entry), () => failsBreak(entry))))

const isUnscoredWithBreak = (entry: ProjectScore): boolean =>
  Match.valueTags(entry.score, { Unscored: () => entry.breakingThreshold !== null, Scored: () => false })

const decide = (command: GateScoreBreakCommand): Result.Result<GateScoreBreakDecision, ScoreBelowBreak> =>
  Option.match(Arr.match(breachesOf(command.projects), { onEmpty: Option.none, onNonEmpty: Option.some }), {
    onNone: () =>
      Result.succeed(
        ScoreAtOrAboveBreak.make({
          unscored: Arr.map(Arr.filter(command.projects, isUnscoredWithBreak), (entry) => entry.project),
        }),
      ),
    onSome: (breaches) => Result.fail(ScoreBelowBreak.make({ breaches, projects: command.projects.length })),
  })

export const gateScoreBreak = Workflow.make({
  command: GateScoreBreakCommand,
  decision: GateScoreBreakDecision,
  error: ScoreBelowBreak,
  decide,
})
