import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
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

export class ExitSignalled extends S.TaggedClass<ExitSignalled>()('ExitSignalled', {
  signal: S.NonNegativeInt,
}) {
  readonly [ExitDecisionTypeId] = ExitDecisionTypeId
}

export const ClassifyExitDecision = S.Union([
  ExitPassed,
  ExitVerdictFailed,
  ExitConfigErrored,
  ExitRuntimeErrored,
  ExitInternalErrored,
  ExitSignalled,
])
export type ClassifyExitDecision = typeof ClassifyExitDecision.Type

const PRECEDENCE = ['InternalError', 'RuntimeError', 'ConfigError', 'VerdictFail'] as const satisfies ReadonlyArray<
  ExitClass
>

const precedenceOf = (pending: ReadonlyArray<ExitClass>) =>
  Arr.findFirst(PRECEDENCE, (candidate) => pending.includes(candidate))

const decisionOf = (exitClass: ExitClass) =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => ExitVerdictFailed.make({})),
    Match.when('ConfigError', () => ExitConfigErrored.make({})),
    Match.when('RuntimeError', () => ExitRuntimeErrored.make({})),
    Match.when('InternalError', () => ExitInternalErrored.make({})),
    Match.exhaustive,
  )

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

const unsignalledDecision = (command: ClassifyExitCommand): Result.Result<ClassifyExitDecision, never> =>
  Option.match(Option.fromNullishOr(verdictExitClass(command.score, command.breakingThreshold)), {
    onNone: () =>
      Option.match(precedenceOf(command.pending), {
        onNone: () => Result.succeed(ExitPassed.make({})),
        onSome: (exitClass) => Result.succeed(decisionOf(exitClass)),
      }),
    onSome: () => Result.succeed(ExitVerdictFailed.make({})),
  })

const decide = (command: ClassifyExitCommand): Result.Result<ClassifyExitDecision, never> =>
  Option.match(Option.fromNullishOr(command.signal), {
    onNone: () => unsignalledDecision(command),
    onSome: (signal) => Result.succeed(ExitSignalled.make({ signal })),
  })

export const classifyExit = Workflow.make({
  command: ClassifyExitCommand,
  decision: ClassifyExitDecision,
  error: S.Never,
  decide,
})
