import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { classifyExit, ClassifyExitCommand } from './classify-exit.workflow.js'

const ExitCodeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ExitCode')
type ExitCodeTypeId = typeof ExitCodeTypeId

export class ResolveExitCodeCommand extends S.TaggedClass<ResolveExitCodeCommand>()('ResolveExitCodeCommand', {
  pending: S.Array(ExitClass),
  signal: S.NullOr(S.Finite),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ExitCodeResolved extends S.TaggedClass<ExitCodeResolved>()('ExitCodeResolved', {
  code: S.Finite,
}) {
  readonly [ExitCodeTypeId] = ExitCodeTypeId
}

const decide = (command: ResolveExitCodeCommand) =>
  Match.value(command.signal).pipe(
    Match.when(null, () =>
      Result.map(
        classifyExit(
          new ClassifyExitCommand({ pending: command.pending, signal: null, score: null, breakingThreshold: null }),
        ),
        (decision) =>
          ExitCodeResolved.make({
            code: Option.match(Option.fromNullishOr(decision.highestClass), {
              onNone: () => 0,
              onSome: ExitClass.codeOf,
            }),
          }),
      )),
    Match.orElse((present) => Result.succeed(ExitCodeResolved.make({ code: 128 + present }))),
  )

export const resolveExitCode = Workflow.make({
  command: ResolveExitCodeCommand,
  decision: ExitCodeResolved,
  error: S.Never,
  decide,
})
