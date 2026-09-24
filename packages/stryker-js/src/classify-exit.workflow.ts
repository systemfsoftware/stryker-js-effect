import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  ClassifyExitCommand,
  ClassifyExitDecision,
  ExitClass,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const highestExitClass = (pending: ReadonlyArray<ExitClass>): ExitClass | null =>
  Match.value(pending.findIndex((candidate) => candidate === 'InternalError')).pipe(
    Match.when(-1, () => pending.reduce<ExitClass | null>(
      (highest, candidate) =>
        Option.match(Option.fromNullishOr(highest), {
          onNone: () => candidate,
          onSome: (current) =>
            Match.value(ExitClass.codeOf(candidate) > ExitClass.codeOf(current)).pipe(
              Match.when(true, (): ExitClass => candidate),
              Match.when(false, (): ExitClass => current),
              Match.exhaustive,
            ),
        }),
      null,
    )),
    Match.orElse((): ExitClass => 'InternalError'),
  )

const verdictExitClass = (score: number | null, breakingThreshold: number | null): ExitClass | null =>
  Option.match(
    Option.all([Option.fromNullishOr(score), Option.fromNullishOr(breakingThreshold)]),
    {
      onNone: (): ExitClass | null => null,
      onSome: ([actual, threshold]) =>
        Match.value(actual < threshold).pipe(
          Match.when(true, (): ExitClass => 'VerdictFail'),
          Match.when(false, (): ExitClass | null => null),
          Match.exhaustive,
        ),
    },
  )

const decide = (command: ClassifyExitCommand): Result.Result<ClassifyExitDecision, never> =>
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

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')

  const severityOf = (exitClass: ExitClass) =>
    Result.match(classifyExit(new ClassifyExitCommand({ pending: [exitClass], signal: null, score: null, breakingThreshold: null })), {
      onFailure: () => Number.NaN,
      onSuccess: (decision) => ExitClass.codeOf(decision.verdictClass ?? exitClass),
    })

  it.prop(
    '∀pair_HighestExitClass_=HighestSeverity',
    [ExitClass, ExitClass],
    ([first, second]) =>
      Result.match(
        classifyExit(new ClassifyExitCommand({ pending: [first, second], signal: null, score: null, breakingThreshold: null })),
        {
          onFailure: () => false,
          onSuccess: (decision) =>
            Option.match(Option.fromNullishOr(decision.highestClass), {
              onNone: () => false,
              onSome: (highest) => severityOf(highest) >= severityOf(first) && severityOf(highest) >= severityOf(second),
            }),
        },
      ),
  )

  it.prop(
    '∀class_ResolveExitCode_≡Baseline',
    [ExitClass],
    ([exitClass]) => ExitClass.codeOf(exitClass) === severityOf(exitClass),
  )
}
