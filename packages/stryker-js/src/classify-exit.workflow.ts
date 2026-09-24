import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ExitClass, ExitCodeFromClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ClassifyExitTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ClassifyExit')
type ClassifyExitTypeId = typeof ClassifyExitTypeId

export class ClassifyExitCommand extends S.TaggedClass<ClassifyExitCommand>()('ClassifyExitCommand', {
  pending: S.Array(ExitClass),
  signal: S.NullOr(S.Finite),
  score: S.NullOr(S.Finite),
  breakingThreshold: S.NullOr(S.Finite),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class HighestExitClass extends S.TaggedClass<HighestExitClass>()('HighestExitClass', {
  exitClass: S.NullOr(ExitClass),
}) {
  readonly [ClassifyExitTypeId] = ClassifyExitTypeId
}

export class VerdictExitClass extends S.TaggedClass<VerdictExitClass>()('VerdictExitClass', {
  verdictClass: S.NullOr(ExitClass),
}) {
  readonly [ClassifyExitTypeId] = ClassifyExitTypeId
}

export const ClassifyExitDecision = S.Union([HighestExitClass, VerdictExitClass])
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

const decide = (command: ClassifyExitCommand) =>
  Result.succeed(
    ClassifyExitDecision.make({
      highestClass: highestExitClass(command.pending),
      verdictClass: verdictExitClass(command.score, command.breakingThreshold),
    }),
  )

export const classifyExit = Workflow.make({
  command: ClassifyExitCommand,
  decision: ClassifyExitDecision,
  error: S.Never,
  decide,
})
