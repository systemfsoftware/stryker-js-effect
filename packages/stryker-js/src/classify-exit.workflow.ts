import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ExitClass, ExitCodeFromClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ExitDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ExitDecision')
type ExitDecisionTypeId = typeof ExitDecisionTypeId

export class ClassifyExitCommand extends S.TaggedClass<ClassifyExitCommand>()('ClassifyExitCommand', {
  pending: S.Array(ExitClass),
  signal: S.NullOr(S.Finite),
  score: S.NullOr(S.Finite),
  breakingThreshold: S.NullOr(S.Finite),
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

const codeOf = (exitClass: ExitClass): number =>
  Option.getOrElse(S.decodeUnknownOption(ExitCodeFromClass)(exitClass), () => -1)

const worstOf = (left: ExitClass | null, right: ExitClass): ExitClass =>
  Option.match(Option.fromNullishOr(left), {
    onNone: () => right,
    onSome: (current) =>
      Match.value(codeOf(right) > codeOf(current)).pipe(
        Match.when(true, () => right),
        Match.when(false, () => current),
        Match.exhaustive,
      ),
  })

const highestExitClass = (pending: ReadonlyArray<ExitClass>): ExitClass | null =>
  pending.reduce<ExitClass | null>((highest, candidate) => worstOf(highest, candidate), null)

const verdictExitClass = (score: number | null, breakingThreshold: number | null) =>
  Option.match(
    Option.all([Option.fromNullishOr(score), Option.fromNullishOr(breakingThreshold)]),
    {
      onNone: () => null,
      onSome: ([actual, threshold]) =>
        Match.value(actual < threshold).pipe(
          Match.when(true, (): ExitClass => 'VerdictFail'),
          Match.when(false, (): ExitClass | null => null),
          Match.exhaustive,
        ),
    },
  )

const decide = (command: ClassifyExitCommand): Result.Result<ClassifyExitDecision, never> =>
  Match.value(verdictExitClass(command.score, command.breakingThreshold) ?? highestExitClass(command.pending)).pipe(
    Match.when('VerdictFail', () => Result.succeed(ExitVerdictFailed.make({}))),
    Match.when('ConfigError', () => Result.succeed(ExitConfigErrored.make({}))),
    Match.when('RuntimeError', () => Result.succeed(ExitRuntimeErrored.make({}))),
    Match.when('InternalError', () => Result.succeed(ExitInternalErrored.make({}))),
    Match.orElse(() => Result.succeed(ExitPassed.make({}))),
  )

export const classifyExit = Workflow.make({
  command: ClassifyExitCommand,
  decision: ClassifyExitDecision,
  error: S.Never,
  decide,
})
