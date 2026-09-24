import { CauseText } from '@systemfsoftware/stryker-js-instrumenter'
import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Cause from 'effect/Cause'
import * as Exit from 'effect/Exit'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as Runtime from 'effect/Runtime'
import * as S from 'effect/Schema'
import * as CliError from 'effect/unstable/cli/CliError'

import { SurvivorsRejection } from './Survivors/mod.js'

export class RunOutcomeCommand extends S.TaggedClass<RunOutcomeCommand>()('RunOutcomeCommand', {
  succeeded: S.Boolean,
  interrupted: S.Boolean,
  helpErrorCount: S.optional(S.Finite),
  cliError: S.Boolean,
  unrecognized: S.optional(S.String),
  survivorsReason: S.optional(S.Literals(['no-report', 'mismatch'])),
  survivorsDiagnostic: S.optional(S.String),
  schemaError: S.Boolean,
  successExitClass: S.optional(ExitClass),
  highestExitClass: S.optional(ExitClass),
  configDetail: S.optional(S.String),
  diagnostic: S.optional(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    succeeded: 'stryker.run_outcome.succeeded',
    interrupted: 'stryker.run_outcome.interrupted',
    helpErrorCount: 'stryker.run_outcome.help_error_count',
    cliError: 'stryker.run_outcome.cli_error',
    survivorsReason: 'stryker.run_outcome.survivors_reason',
    schemaError: 'stryker.run_outcome.schema_error',
    successExitClass: 'stryker.run_outcome.success_exit_class',
    highestExitClass: 'stryker.run_outcome.highest_exit_class',
  } as const

  static readonly fromExit = (input: {
    readonly exit: Exit.Exit<unknown, unknown>
    readonly argv: readonly string[]
  }) => gatherRunOutcomeOf(input)
}
export class RunExit extends S.TaggedError<RunExit>()('RunExit', { code: S.Finite }) {
  override get [Runtime.errorExitCode](): number {
    return this.code
  }
}

const CONFIG_CODE = 2

const classCode = (exitClass: ExitClass): number =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => 1),
    Match.when('ConfigError', () => CONFIG_CODE),
    Match.when('RuntimeError', () => 3),
    Match.when('InternalError', () => 4),
    Match.exhaustive,
  )

const RunOutcomeTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/RunOutcome')
type RunOutcomeTypeId = typeof RunOutcomeTypeId

export class RunOk extends S.TaggedClass<RunOk>()('RunOk', {
  help: S.Boolean,
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunInterrupted extends S.TaggedError<RunInterrupted>()('RunInterrupted', {
  code: S.Finite,
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunParseFailed extends S.TaggedClass<RunParseFailed>()('RunParseFailed', {
  unrecognized: S.optional(S.String),
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunSurvivorsRejected extends S.TaggedClass<RunSurvivorsRejected>()('RunSurvivorsRejected', {
  reason: S.Literals(['no-report', 'mismatch']),
  diagnostic: S.optional(S.String),
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunConfigFailed extends S.TaggedClass<RunConfigFailed>()('RunConfigFailed', {
  detail: S.optional(S.String),
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export class RunFailed extends S.TaggedClass<RunFailed>()('RunFailed', {
  code: S.Finite,
  diagnostic: S.optional(S.String),
}) {
  readonly [RunOutcomeTypeId] = RunOutcomeTypeId
}

export type RunOutcomeDecision =
  | RunOk
  | RunParseFailed
  | RunSurvivorsRejected
  | RunConfigFailed
  | RunFailed

export type RunOutcomeError = RunInterrupted

export type FailedRunOutcome = Exclude<RunOutcomeDecision, RunOk> | RunOutcomeError

type SucceededCommand = RunOutcomeCommand & { readonly succeeded: true }
type HelpCommand = RunOutcomeCommand & { readonly helpErrorCount: number }
type SurvivorsCommand = RunOutcomeCommand & { readonly survivorsReason: 'no-report' | 'mismatch' }
type ClassedCommand = RunOutcomeCommand & { readonly highestExitClass: ExitClass }

const isSucceeded = (command: RunOutcomeCommand): command is SucceededCommand => command.succeeded
const isHelpRun = (command: RunOutcomeCommand): command is HelpCommand => command.helpErrorCount !== undefined
const isSurvivorsRun = (command: RunOutcomeCommand): command is SurvivorsCommand =>
  command.survivorsReason !== undefined
const isHighestClassed = (command: RunOutcomeCommand): command is ClassedCommand =>
  command.highestExitClass !== undefined

const succeededOutcome = (command: SucceededCommand): RunOutcomeDecision =>
  Option.match(Option.fromUndefinedOr(command.successExitClass), {
    onNone: () => RunOk.make({ help: false }),
    onSome: (exitClass) => RunFailed.make({ code: classCode(exitClass), diagnostic: command.diagnostic }),
  })

const helpOutcome = (command: HelpCommand): RunOutcomeDecision =>
  Match.value(command.helpErrorCount > 0).pipe(
    Match.when(true, () => RunParseFailed.make({ unrecognized: command.unrecognized })),
    Match.orElse(() => RunOk.make({ help: true })),
  )

const parseFailedOutcome = (command: RunOutcomeCommand): RunOutcomeDecision =>
  RunParseFailed.make({ unrecognized: command.unrecognized })

const survivorsRejectedOutcome = (command: SurvivorsCommand): RunOutcomeDecision =>
  RunSurvivorsRejected.make({
    reason: command.survivorsReason,
    diagnostic: command.survivorsDiagnostic,
  })

const configFailedOutcome = (command: RunOutcomeCommand): RunOutcomeDecision =>
  RunConfigFailed.make({ detail: command.configDetail })

const classedOutcome = (command: ClassedCommand): RunOutcomeDecision =>
  Match.value(command.highestExitClass).pipe(
    Match.when('ConfigError', () => RunConfigFailed.make({ detail: command.configDetail })),
    Match.orElse((exitClass) => RunFailed.make({ code: classCode(exitClass), diagnostic: command.diagnostic })),
  )

const genericFailureOutcome = (command: RunOutcomeCommand): RunOutcomeDecision =>
  RunFailed.make({ code: 1, diagnostic: command.diagnostic })

function classify(command: RunOutcomeCommand): RunOutcomeDecision | RunOutcomeError {
  return Match.value(command).pipe(
    Match.when(isSucceeded, succeededOutcome),
    Match.when((interrupted): boolean => interrupted.interrupted, () => RunInterrupted.make({ code: 130 })),
    Match.when(isHelpRun, helpOutcome),
    Match.when((cliError): boolean => cliError.cliError, parseFailedOutcome),
    Match.when(isSurvivorsRun, survivorsRejectedOutcome),
    Match.when((schemaError): boolean => schemaError.schemaError, configFailedOutcome),
    Match.when(isHighestClassed, classedOutcome),
    Match.orElse(genericFailureOutcome),
  )
}

export const classifyRunOutcome = Workflow.make({
  command: RunOutcomeCommand,
  decision: S.Union([RunOk, RunParseFailed, RunSurvivorsRejected, RunConfigFailed, RunFailed]),
  error: RunInterrupted,
  decide: (command): Result.Result<RunOutcomeDecision, RunOutcomeError> =>
    Match.value(classify(command)).pipe(
      Match.tag('RunInterrupted', (error) => Result.fail(error)),
      Match.when(
        (outcome): outcome is RunOutcomeDecision => !S.is(RunInterrupted)(outcome),
        (decision) => Result.succeed(decision),
      ),
      Match.exhaustive,
    ),
})

const UNKNOWN_FAILURE = 'Unknown failure'
const MAX_TRAVERSAL_DEPTH = 10

const asExitClass = Option.liftPredicate(S.is(ExitClass))

const hasExitClass = Predicate.hasProperty('exitClass')

const hasCause = Predicate.hasProperty('cause')

const hasReason = Predicate.hasProperty('reason')

const hasMessageField = Predicate.hasProperty('message')

const hasVerdict = Predicate.hasProperty('verdict')

const exitClassFieldOf = <A>(carrier: { readonly exitClass: A }) =>
  Option.getOrUndefined(asExitClass(carrier.exitClass))

const exitClassOf = <A>(value: A) =>
  Match.value(value).pipe(
    Match.when(hasExitClass, (carrier) => exitClassFieldOf(carrier)),
    Match.orElse(() => undefined),
  )

const verdictExitClassOf = <A>(value: A) =>
  Match.value(value).pipe(
    Match.when(hasVerdict, (carrier) => exitClassFieldOf(carrier)),
    Match.orElse(() => undefined),
  )

const successExitClassOf = <A>(exit: A) =>
  Option.getOrUndefined(
    Option.flatMap(Option.filter(Option.some(exit), Exit.isSuccess), (success) =>
      Option.fromNullishOr(verdictExitClassOf(success.value))),
  )

const declaredReasonOf = (value: { readonly reason: unknown }) => value.reason

const declaredMessageOf = (value: { readonly message: unknown }) => value.message

const unknownCauseOf = (value: { readonly cause: unknown }) => value.cause

const reasonFieldOf = <A>(value: A) =>
  Match.value(value).pipe(
    Match.when(hasReason, (carrier) => declaredReasonOf(carrier)),
    Match.orElse(() => undefined),
  )

const messageFieldOf = <A>(value: A) =>
  Match.value(value).pipe(
    Match.when(hasMessageField, (carrier) => declaredMessageOf(carrier)),
    Match.orElse(() => undefined),
  )

const causeFieldOf = <A>(value: A) =>
  Match.value(value).pipe(
    Match.when(hasCause, (carrier) => unknownCauseOf(carrier)),
    Match.orElse(() => undefined),
  )

const causeTextOf = (value: { readonly cause: unknown }) =>
  Option.map(CauseText.fromCause(value.cause), (decoded) => decoded.text)

const reasonOf = (value: { readonly reason: unknown }) =>
  Option.flatMap(nonEmptyText(value.reason), (reason) =>
    Option.match(causeTextOf({ cause: causeFieldOf(value) }), {
      onNone: () => Option.some(reason),
      onSome: (detail) => Option.some(`${reason}: ${detail}`),
    }))

const firstConfiguredTextOf = (value: { readonly reason: unknown; readonly message: unknown }) =>
  Option.orElse(nonEmptyText(value.reason), () => nonEmptyText(value.message))

const configDetailAt = (value: { readonly reason: unknown; readonly message: unknown }) =>
  Match.value(exitClassOf(value)).pipe(
    Match.when('ConfigError', () => firstConfiguredTextOf(value)),
    Match.orElse(() => Option.none()),
  )

const reachableAt = <A>(value: A, depth: number, seen: WeakSet<object>) =>
  Option.filter(
    Option.filter(Option.some(value), Predicate.isObjectOrArray),
    (candidate) => depth <= MAX_TRAVERSAL_DEPTH && !seen.has(candidate),
  )

const causeChildrenOf = <A>(value: { readonly cause: A }) =>
  Match.value(Option.fromNullishOr(value.cause)).pipe(
    Match.when(Option.isSome, (cause) => (Array.isArray(cause.value) ? cause.value : [cause.value])),
    Match.orElse(() => []),
  )

const findWalkOf = <A, B>(
  value: A,
  depth: number,
  seen: WeakSet<object>,
  read: (node: { readonly cause: unknown; readonly reason: unknown; readonly message: unknown }) => Option.Option<B>,
): Option.Option<B> =>
  Option.flatMap(reachableAt(value, depth, seen), (node) =>
    Match.value(visitReachable(node, seen)).pipe(
      Match.when(
        (visited): visited is { readonly cause: unknown; readonly reason: unknown; readonly message: unknown } =>
          hasCause(visited) && hasReason(visited) && hasMessageField(visited),
        (carrier) =>
          Option.orElse(read(carrier), () =>
            causeChildrenOf(carrier).reduce<Option.Option<B>>(
              (found, child) =>
                Option.match(found, {
                  onSome: () => found,
                  onNone: () => findWalkOf(child, depth + 1, seen, read),
                }),
              Option.none(),
            )),
      ),
      Match.orElse((simple) => read(simple)),
    ))

const visitReachable = <A>(node: A, seen: WeakSet<object>) =>
  Match.value(Predicate.isObjectOrArray(node)).pipe(
    Match.when(true, (visitable) => {
      seen.add(visitable)
      return visitable
    }),
    Match.orElse(() => node),
  )

const collectExitClassesFrom = <A>(value: A, depth: number, seen: WeakSet<object>): ReadonlyArray<ExitClass> =>
  Option.match(reachableAt(value, depth, seen), {
    onNone: () => [],
    onSome: (node) =>
      Match.value(visitReachable(node, seen)).pipe(
        Match.when(hasCause, (carrier) => [...exitClassListOf(node), ...collectChildrenOf(carrier, depth, seen)]),
        Match.orElse(() => exitClassListOf(node)),
      ),
  })

const exitClassListOf = <A>(node: A) => Option.toArray(Option.fromNullishOr(exitClassOf(node)))

const collectChildrenOf = <A>(carrier: { readonly cause: unknown }, depth: number, seen: WeakSet<object>) =>
  causeChildrenOf(carrier).flatMap((child) => collectExitClassesFrom(child, depth + 1, seen))

const collectExitClassesOf = <A>(exit: A): ReadonlyArray<ExitClass> =>
  Option.match(failurePayloadsOf(exit), {
    onNone: () => [],
    onSome: (payloads) => payloads.flatMap((payload) => collectExitClassesFrom(payload, 0, new WeakSet())),
  })

const isNonNullObject = (value: { readonly defect?: never }): value is object =>
  typeof value === 'object' && value !== null

const dieDefectOf = (reason: Cause.Reason<unknown>) =>
  Match.value(reason).pipe(
    Match.when(Cause.isDieReason, (die) => Option.some(die.defect)),
    Match.orElse(() => Option.none()),
  )

const objectPayloadOf = (reason: Cause.Reason<unknown>) =>
  Option.getOrUndefined(Option.filter(dieDefectOf(reason), isNonNullObject))

const causePayloadOf = (reason: Cause.Reason<unknown>) =>
  Match.value(reason).pipe(
    Match.when(Cause.isFailReason, (fail) => fail.error),
    Match.orElse(objectPayloadOf),
  )

const failurePayloadsOf = <A>(exit: A) =>
  Option.map(Option.filter(Option.some(exit), Exit.isFailure), (failure) =>
    failure.cause.reasons.map(causePayloadOf))

const firstConfigErrorDetailOf = <A>(exit: A) =>
  Option.getOrUndefined(
    Option.flatMap(failurePayloadsOf(exit), (payloads) =>
      Arr.findFirst([...payloads].reverse(), (root) => findWalkOf(root, 0, new WeakSet(), configDetailAt))),
  )

const failureValueOf = <A>(exit: A) =>
  Option.getOrUndefined(
    Option.flatMap(Option.filter(Option.some(exit), Exit.isFailure), (failure) => Cause.findErrorOption(failure.cause)),
  )

const isMessageError = Predicate.isError

const messageErrorTextOf = <A>(value: A) =>
  Match.value(value).pipe(
    Match.when(
      (candidate): candidate is Error & { readonly message: string } =>
        isMessageError(candidate) && candidate.message.length > 0,
      (error) => Option.some(error.message),
    ),
    Match.orElse(() => Option.none()),
  )

const isPrimitiveText = Predicate.some([
  Predicate.isString,
  Predicate.isNumber,
  Predicate.isBoolean,
  Predicate.isBigInt,
  Predicate.isSymbol,
])

const primitiveTextOf = <A>(value: A) =>
  Match.value(value).pipe(
    Match.when(isPrimitiveText, (primitive) => Option.some(String(primitive))),
    Match.orElse(() => Option.none()),
  )

const failureValueDescriptionOf = <A>(value: A) =>
  Option.orElse(
    Option.orElse(
      Option.orElse(survivorsRemediationOf(value), () => reasonTextOf(value)),
      () => messageErrorTextOf(value),
    ),
    () => primitiveTextOf(value),
  )

const declaresReasonText = (value: { readonly reason: unknown }) => Option.isSome(nonEmptyText(value.reason))

const reasonTextOf = (value: { readonly reason: unknown; readonly cause: unknown }) =>
  Boolean.match(declaresReasonText(value), {
    onTrue: () =>
      Option.flatMap(nonEmptyText(value.reason), (reason) =>
        Option.match(causeTextOf({ cause: value.cause }), {
          onNone: () => Option.some(reason),
          onSome: (detail) => Option.some(`${reason}: ${detail}`),
        })),
    onFalse: () => Option.none(),
  })

const survivorsRemediationOf = <A>(value: A) =>
  Match.value(value).pipe(
    Match.when(isSurvivorsRejection, (rejection) => Option.some(rejection.remediation)),
    Match.orElse(() => Option.none()),
  )

const failureDescriptionOf = <A>(exit: A) =>
  Option.orElse(
    Option.orElse(
      failureValueDescriptionOf(failureValueOf(exit)),
      () => Option.fromNullishOr(firstConfigErrorDetailOf(exit)),
    ),
    () =>
      Option.flatMap(Option.filter(Option.some(exit), Exit.isFailure), (failure) =>
        nonEmptyText(Cause.pretty(failure.cause))),
  )

const describeFailureOf = <A>(exit: A) => Option.getOrElse(failureDescriptionOf(exit), () => UNKNOWN_FAILURE)

const showHelpErrorsOf = <A>(value: A): Option.Option<ReadonlyArray<CliError.CliError>> =>
  Match.value(value).pipe(
    Match.when(isShowHelp, (help) => Option.some(help.errors)),
    Match.orElse(() => Option.none()),
  )

const singleCliErrorOf = <A>(value: A): Option.Option<ReadonlyArray<CliError.CliError>> =>
  Match.value(value).pipe(
    Match.when(CliError.isCliError, (cliError) => Option.some([cliError])),
    Match.orElse(() => Option.none()),
  )

const cliErrorListOf = <A>(exit: A) =>
  Option.match(showHelpErrorsOf(failureValueOf(exit)), {
    onSome: Option.some,
    onNone: () => singleCliErrorOf(failureValueOf(exit)),
  })

const followingArgumentOf = (argv: readonly string[], option: string) =>
  Match.value(argv.indexOf(option)).pipe(
    Match.when((at) => at >= 0, (at) => Option.fromNullishOr(argv[at + 1])),
    Match.orElse(() => Option.none()),
  )

const unrecognizedArgumentOf = (argv: readonly string[], option: string) =>
  Option.getOrElse(
    Option.filter(followingArgumentOf(argv, option), (argument) => !argument.startsWith('-')),
    () => option,
  )

const argumentHintOf = (error: CliError.CliError, argv: readonly string[]) =>
  Match.value(error).pipe(
    Match.tag('UnrecognizedOption', (unrecognized) =>
      Option.some(unrecognizedArgumentOf(argv, unrecognized.option))),
    Match.tag('UnexpectedArgument', (unexpected) => Option.fromNullishOr(unexpected.arguments[0])),
    Match.tag('UnknownSubcommand', (unknown) => Option.some(unknown.subcommand)),
    Match.orElse(() => Option.none()),
  )

const unrecognizedHintOf = <A>(exit: A, argv: readonly string[]) =>
  Option.getOrUndefined(
    Option.flatMap(cliErrorListOf(exit), (errors) => Arr.findFirst(errors, (error) => argumentHintOf(error, argv))),
  )

const survivorsReasonOf = <A>(value: A) =>
  Match.value(value).pipe(
    Match.when(isSurvivorsRejection, (rejection) => Option.some(rejection.reason)),
    Match.orElse(() => Option.none()),
  )

const hasOnlyInterruptsOf = <A>(exit: A) =>
  Option.match(Option.filter(Option.some(exit), Exit.isFailure), {
    onSome: (failure) => Cause.hasInterruptsOnly(failure.cause),
    onNone: () => false,
  })

const carriesCliError = <A>(value: A) => value !== undefined && CliError.isCliError(value)

const carriesSchemaError = <A>(value: A) => value !== undefined && S.isSchemaError(value)

const helpErrorCountOf = <A>(value: A) =>
  Match.value(value).pipe(
    Match.when(isShowHelp, (help) => Option.some(help.errors.length)),
    Match.orElse(() => Option.none<number>()),
  )

const omitUnknownFailure = (diagnostic: string) =>
  Option.getOrUndefined(Option.filter(Option.some(diagnostic), (candidate) => candidate !== UNKNOWN_FAILURE))

const highestExitClassOf = (pending: ReadonlyArray<ExitClass>) =>
  pending.reduce<ExitClass | null>(
    (highest, candidate) =>
      Option.match(Option.fromNullishOr(highest), {
        onNone: () => candidate,
        onSome: (current) =>
          Boolean.match(classCode(candidate) > classCode(current), {
            onTrue: () => candidate,
            onFalse: () => current,
          }),
      }),
    null,
  )

const gatherRunOutcomeOf = (input: {
  readonly exit: Exit.Exit<unknown, unknown>
  readonly argv: readonly string[]
}) => {
  const { exit, argv } = input
  const value = failureValueOf(exit)
  return RunOutcomeCommand.make({
    succeeded: Option.isSome(Option.filter(Option.some(exit), Exit.isSuccess)),
    interrupted: hasOnlyInterruptsOf(exit),
    helpErrorCount: Option.getOrUndefined(helpErrorCountOf(value)),
    cliError: carriesCliError(value),
    unrecognized: unrecognizedHintOf(exit, argv),
    survivorsReason: Option.getOrUndefined(survivorsReasonOf(value)),
    survivorsDiagnostic: Option.getOrUndefined(survivorsRemediationOf(value)),
    schemaError: carriesSchemaError(value),
    successExitClass: successExitClassOf(exit),
    highestExitClass: Option.getOrUndefined(Option.fromNullishOr(highestExitClassOf(collectExitClassesOf(exit)))),
    configDetail: firstConfigErrorDetailOf(exit),
    diagnostic: omitUnknownFailure(describeFailureOf(exit)),
  })
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const ExitModule = await import('effect/Exit')

  it.prop('∀text_RunOutcomeCommand.fromExit_PrimitiveFailureBecomesDiagnostic', [S.String], ([text]) => {
    const command = RunOutcomeCommand.fromExit({ exit: ExitModule.fail(text), argv: [] })
    return command.succeeded === false && command.interrupted === false && command.cliError === false &&
      command.helpErrorCount === undefined && command.unrecognized === undefined &&
      command.highestExitClass === undefined && command.configDetail === undefined &&
      (text === UNKNOWN_FAILURE ? command.diagnostic === undefined : command.diagnostic === text)
  })

  it.prop('∀deeperList_RunOutcomeCommand.fromExit_FindsConfigDetail', [S.NonEmptyString], ([detail]) => {
    const exit = ExitModule.fail({ exitClass: 'ConfigError', reason: detail })
    return RunOutcomeCommand.fromExit({ exit, argv: [] }).configDetail === detail
  })

  it.prop('∀leftMiddleRight_RunOutcomeCommand.fromExit_KeepsHighestExitClass', [ExitClass, ExitClass, ExitClass], ([left, middle, right]) => {
    const exit = ExitModule.fail({ exitClass: left, cause: { exitClass: middle, cause: { exitClass: right } } })
    const command = RunOutcomeCommand.fromExit({ exit, argv: [] })
    return command.succeeded === false && command.highestExitClass !== undefined &&
      classCode(command.highestExitClass) >= classCode(left) && classCode(command.highestExitClass) >= classCode(middle) &&
      classCode(command.highestExitClass) >= classCode(right)
  })
}
