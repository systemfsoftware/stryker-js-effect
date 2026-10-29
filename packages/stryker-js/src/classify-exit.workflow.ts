import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ExitDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ExitDecision')
type ExitDecisionTypeId = typeof ExitDecisionTypeId

export class ClassifyExitCommand
  extends S.TaggedClass<ClassifyExitCommand, { readonly brand: unique symbol }>()('ClassifyExitCommand', {
    pending: S.Array(Plugin.ExitClass),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ExitPassed
  extends S.TaggedClass<ExitPassed, { readonly brand: unique symbol }>()('ExitPassed', { exitClass: S.Null })
{
  readonly [ExitDecisionTypeId] = ExitDecisionTypeId
}

export class ExitVerdictFailed
  extends S.TaggedClass<ExitVerdictFailed, { readonly brand: unique symbol }>()('ExitVerdictFailed', {
    exitClass: S.tag('VerdictFail'),
  })
{
  readonly [ExitDecisionTypeId] = ExitDecisionTypeId
}

export class ExitConfigErrored
  extends S.TaggedClass<ExitConfigErrored, { readonly brand: unique symbol }>()('ExitConfigErrored', {
    exitClass: S.tag('ConfigError'),
  })
{
  readonly [ExitDecisionTypeId] = ExitDecisionTypeId
}

export class ExitRuntimeErrored
  extends S.TaggedClass<ExitRuntimeErrored, { readonly brand: unique symbol }>()('ExitRuntimeErrored', {
    exitClass: S.tag('RuntimeError'),
  })
{
  readonly [ExitDecisionTypeId] = ExitDecisionTypeId
}

export class ExitInternalErrored
  extends S.TaggedClass<ExitInternalErrored, { readonly brand: unique symbol }>()('ExitInternalErrored', {
    exitClass: S.tag('InternalError'),
  })
{
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

const decisionOf = (exitClass: Plugin.ExitClass): ClassifyExitDecision =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => ExitVerdictFailed.make({})),
    Match.when('ConfigError', () => ExitConfigErrored.make({})),
    Match.when('RuntimeError', () => ExitRuntimeErrored.make({})),
    Match.when('InternalError', () => ExitInternalErrored.make({})),
    Match.exhaustive,
  )

const decide = (command: ClassifyExitCommand): Result.Result<ClassifyExitDecision, never> =>
  Option.match(precedenceOf(command.pending), {
    onNone: () => Result.succeed(ExitPassed.make({ exitClass: null })),
    onSome: (exitClass) => Result.succeed(decisionOf(exitClass)),
  })

export const classifyExit = Workflow.make({
  command: ClassifyExitCommand,
  decision: ClassifyExitDecision,
  error: S.Never,
  decide,
})
