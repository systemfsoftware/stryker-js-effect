import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Plugin, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ExitDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ExitDecision')
type ExitDecisionTypeId = typeof ExitDecisionTypeId

export class ClassifyExitCommand extends S.TaggedClass<ClassifyExitCommand>()('ClassifyExitCommand', {
  pending: S.Array(Plugin.ExitClass),
  score: Report.MutationScore,
  breakingThreshold: S.NullOr(Report.Percentage),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ExitPassed extends S.TaggedClass<ExitPassed>()('ExitPassed', {}) {
  readonly [ExitDecisionTypeId] = ExitDecisionTypeId
}

export class ExitVerdictFailed extends S.TaggedClass<ExitVerdictFailed>()('ExitVerdictFailed', {}) {
  readonly [ExitDecisionTypeId] = ExitDecisionTypeId
}

export class ExitConfigErrored extends S.TaggedClass<ExitConfigErrored>()('ExitConfigErrored', {}) {
  readonly [ExitDecisionTypeId] = ExitDecisionTypeId
}

export class ExitRuntimeErrored extends S.TaggedClass<ExitRuntimeErrored>()('ExitRuntimeErrored', {}) {
  readonly [ExitDecisionTypeId] = ExitDecisionTypeId
}

export class ExitInternalErrored extends S.TaggedClass<ExitInternalErrored>()('ExitInternalErrored', {}) {
  readonly [ExitDecisionTypeId] = ExitDecisionTypeId
}

export const ClassifyExitDecision = S.Union([
  ExitPassed,
  ExitVerdictFailed,
  ExitConfigErrored,
  ExitRuntimeErrored,
  ExitInternalErrored,
])
export type ClassifyExitDecision = typeof ClassifyExitDecision.Type

const PRECEDENCE = ['InternalError', 'RuntimeError', 'ConfigError', 'VerdictFail'] as const satisfies ReadonlyArray<
  Plugin.ExitClass
>

const precedenceOf = (pending: ReadonlyArray<Plugin.ExitClass>) =>
  Arr.findFirst(PRECEDENCE, (candidate) => pending.includes(candidate))

const decisionOf = (exitClass: Plugin.ExitClass) =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => ExitVerdictFailed.make({})),
    Match.when('ConfigError', () => ExitConfigErrored.make({})),
    Match.when('RuntimeError', () => ExitRuntimeErrored.make({})),
    Match.when('InternalError', () => ExitInternalErrored.make({})),
    Match.exhaustive,
  )

const verdictExitClass = (score: Report.MutationScore, breakingThreshold: number | null) =>
  Match.valueTags(score, {
    Unscored: () => null,
    Scored: ({ percentage }) =>
      Option.match(Option.fromNullishOr(breakingThreshold), {
        onNone: () => null,
        onSome: (threshold) =>
          Match.value(percentage < threshold).pipe(
            Match.when(true, (): Plugin.ExitClass => 'VerdictFail'),
            Match.when(false, (): Plugin.ExitClass | null => null),
            Match.exhaustive,
          ),
      }),
  })

const decide = (command: ClassifyExitCommand): Result.Result<ClassifyExitDecision, never> =>
  Option.match(Option.fromNullishOr(verdictExitClass(command.score, command.breakingThreshold)), {
    onNone: () =>
      Option.match(precedenceOf(command.pending), {
        onNone: () => Result.succeed(ExitPassed.make({})),
        onSome: (exitClass) => Result.succeed(decisionOf(exitClass)),
      }),
    onSome: () => Result.succeed(ExitVerdictFailed.make({})),
  })

export const classifyExit = Workflow.make({
  command: ClassifyExitCommand,
  decision: ClassifyExitDecision,
  error: S.Never,
  decide,
})
