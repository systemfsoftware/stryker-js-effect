import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
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

export class ClassifyExitDecision extends S.TaggedClass<ClassifyExitDecision>()('ClassifyExitDecision', {
  highestClass: S.NullOr(ExitClass),
  verdictClass: S.NullOr(ExitClass),
}) {
  readonly [ClassifyExitTypeId] = ClassifyExitTypeId
}

const highestExitClass = (pending: ReadonlyArray<ExitClass>) =>
  pending.reduce<ExitClass | null>(
    (highest, candidate) =>
      Option.match(Option.fromNullishOr(highest), {
        onNone: () => candidate,
        onSome: (current) =>
          Match.value(ExitClass.codeOf(candidate) > ExitClass.codeOf(current)).pipe(
            Match.when(true, () => candidate),
            Match.when(false, () => current),
            Match.exhaustive,
          ),
      }),
    null,
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
