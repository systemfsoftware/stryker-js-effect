import { CauseText } from '@systemfsoftware/stryker-js-instrumenter'
import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
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

  static readonly fromExit = <A, E>(input: {
    readonly exit: Exit.Exit<A, E>
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

const nonEmptyText = Option.liftPredicate(S.is(S.NonEmptyString))

const failedExit = Option.liftPredicate(Exit.isFailure)

const hasExitClass = Predicate.hasProperty('exitClass')

const hasVerdict = Predicate.hasProperty('verdict')

const hasCause = Predicate.hasProperty('cause')

const hasReason = Predicate.hasProperty('reason')

const hasMessageField = Predicate.hasProperty('message')

const isUnseenObject = <A>(value: A, seen: WeakSet<object>): value is A & object =>
  Predicate.isObjectOrArray(value) && !seen.has(value)
  // Test change

  depth <= MAX_TRAVERSAL_DEPTH && isUnseenObject(value, seen)

const causeChildrenOf = (value: object): ReadonlyArray<object> => {
  const cause = hasCause(value) ? value.cause : undefined
  if (Array.isArray(cause)) {
    return cause.filter(Predicate.isObjectOrArray)
  }
  return Predicate.isObjectOrArray(cause) ? [cause] : []
}

const visitReachableValue = <A>(
  value: A,
  depth: number,
  seen: WeakSet<object>,
  visit: (node: object) => void,
): void => {
  if (isReachableValue(value, depth, seen)) {
    seen.add(value)
    visit(value)
    causeChildrenOf(value).forEach((child) => visitReachableValue(child, depth + 1, seen, visit))
  }
}

const findReachableValue = <A, B>(
  value: A,
  depth: number,
  seen: WeakSet<object>,
  read: (node: object) => Option.Option<B>,
): Option.Option<B> => {
  if (!isReachableValue(value, depth, seen)) {
    return Option.none()
  }
  seen.add(value)
  return Option.orElse(read(value), () =>
    Arr.findFirst(causeChildrenOf(value), (child) => findReachableValue(child, depth + 1, seen, read)))
}

const causePayloadOf = <E>(reason: Cause.Reason<E>): E | object | undefined =>
  Cause.isFailReason(reason) ? reason.error : objectPayloadOf(reason)

const objectPayloadOf = <E>(reason: Cause.Reason<E>): object | undefined =>
  Option.getOrUndefined(Option.filter(dieDefectOf(reason), Predicate.isObject))

const dieDefectOf = <E>(reason: Cause.Reason<E>) =>
  Cause.isDieReason(reason) ? Option.some(reason.defect) : Option.none()

const failurePayloads = <A, E>(exit: Exit.Exit<A, E>): ReadonlyArray<E | object | undefined> =>
  Option.getOrElse(
    Option.map(failedExit(exit), (failure) => failure.cause.reasons.map(causePayloadOf)),
    (): ReadonlyArray<E | object | undefined> => [],
  )

const exitClassOf = <A>(value: A): ExitClass | undefined => {
  if (!hasExitClass(value)) {
    return undefined
  }
  return Option.getOrUndefined(asExitClass(value.exitClass))
}

const appendExitClass = (value: object, out: Array<ExitClass>): void => {
  const declared = exitClassOf(value)
  if (declared !== undefined) {
    out.push(declared)
  }
}

const collectExitClasses = <A, E>(exit: Exit.Exit<A, E>): Array<ExitClass> => {
  const out: Array<ExitClass> = []
  const seen = new WeakSet<object>()
  failurePayloads(exit).forEach((payload) =>
    visitReachableValue(payload, 0, seen, (node) => appendExitClass(node, out)))
  return out
}

const causeTextOf = <A>(value: A): Option.Option<string> =>
  Option.map(CauseText.fromCause(hasCause(value) ? value.cause : undefined), (decoded) => decoded.text)

const reasonOf = <A>(value: A): string | undefined => {
  const declared = hasReason(value) ? value.reason : undefined
  return Option.getOrUndefined(
    Option.map(nonEmptyText(declared), (reason) =>
      Option.match(causeTextOf(value), {
        onNone: () => reason,
        onSome: (detail) => `${reason}: ${detail}`,
      })),
  )
}

const firstConfiguredText = <A>(value: A): Option.Option<string> => {
  const reason = hasReason(value) ? value.reason : undefined
  const message = hasMessageField(value) ? value.message : undefined
  return Option.orElse(nonEmptyText(reason), () => nonEmptyText(message))
}

const configDetailAt = (value: object): Option.Option<string> =>
  exitClassOf(value) === 'ConfigError' ? firstConfiguredText(value) : Option.none()

const firstConfigErrorDetail = <A, E>(exit: Exit.Exit<A, E>): string | undefined => {
  const seen = new WeakSet<object>()
  const roots = [...failurePayloads(exit)].reverse()
  return Option.getOrUndefined(
    Arr.findFirst(roots, (root) => findReachableValue(root, 0, seen, configDetailAt)),
  )
}

const PRIMITIVE_REFINEMENTS = [
  Predicate.isString,
  Predicate.isNumber,
  Predicate.isBoolean,
  Predicate.isBigInt,
  Predicate.isSymbol,
]

const isPrimitiveText = Predicate.some(PRIMITIVE_REFINEMENTS)

const declaresReasonText = <A>(value: A): boolean =>
  hasReason(value) && Option.isSome(nonEmptyText(value.reason))

const remediationTextOf = <A>(value: A): Option.Option<string> =>
  S.is(SurvivorsRejection)(value) ? Option.some(value.remediation) : Option.none()

const reasonTextOf = <A>(value: A): Option.Option<string> =>
  declaresReasonText(value) ? Option.fromNullishOr(reasonOf(value)) : Option.none()

const errorMessageTextOf = <A>(value: A): Option.Option<string> =>
  Option.flatMap(Option.filter(Option.some(value), Predicate.isError), (error) => nonEmptyText(error.message))

const primitiveTextOf = <A>(value: A): Option.Option<string> =>
  isPrimitiveText(value) ? Option.some(String(value)) : Option.none()

const failureValueDescription = <A>(value: A): Option.Option<string> =>
  remediationTextOf(value).pipe(
    Option.orElse(() => reasonTextOf(value)),
    Option.orElse(() => errorMessageTextOf(value)),
    Option.orElse(() => primitiveTextOf(value)),
  )

const failureValueOf = <A, E>(exit: Exit.Exit<A, E>): E | undefined =>
  Option.getOrUndefined(Option.flatMap(failedExit(exit), (failure) => Cause.findErrorOption(failure.cause)))

const failureDescriptionOf = <A, E>(exit: Exit.Exit<A, E>): Option.Option<string> =>
  failureValueDescription(failureValueOf(exit)).pipe(
    Option.orElse(() => Option.fromNullishOr(firstConfigErrorDetail(exit))),
    Option.orElse(() => Option.flatMap(failedExit(exit), (failure) => nonEmptyText(Cause.pretty(failure.cause)))),
  )

const describeFailureOf = <A, E>(exit: Exit.Exit<A, E>): string =>
  Option.getOrElse(failureDescriptionOf(exit), () => UNKNOWN_FAILURE)

const showHelpErrors = (help: CliError.ShowHelp): ReadonlyArray<CliError.CliError> => help.errors

const showHelpErrorsOf = <A>(value: A): Option.Option<ReadonlyArray<CliError.CliError>> =>
  S.is(CliError.ShowHelp)(value) ? Option.some(showHelpErrors(value)) : Option.none()

const cliErrorListOf = <A, E>(exit: Exit.Exit<A, E>): Option.Option<ReadonlyArray<CliError.CliError>> => {
  const value = failureValueOf(exit)
  return Option.match(showHelpErrorsOf(value), {
    onSome: (errors) => Option.some(errors),
    onNone: () => (CliError.isCliError(value) ? Option.some([value]) : Option.none()),
  })
}

const followingArgumentOf = (argv: readonly string[], option: string): Option.Option<string> =>
  Match.value(argv.indexOf(option)).pipe(
    Match.when((at) => at >= 0, (at) => Option.fromNullishOr(argv[at + 1])),
    Match.orElse(() => Option.none()),
  )

const unrecognizedArgumentOf = (argv: readonly string[], option: string): string =>
  Option.getOrElse(
    Option.filter(followingArgumentOf(argv, option), (argument) => !argument.startsWith('-')),
    () => option,
  )

const argumentHintOf = (error: CliError.CliError, argv: readonly string[]): Option.Option<string> =>
  Match.value(error).pipe(
    Match.tag('UnrecognizedOption', (unrecognized) => Option.some(unrecognizedArgumentOf(argv, unrecognized.option))),
    Match.tag('UnexpectedArgument', (unexpected) => Option.fromNullishOr(unexpected.arguments[0])),
    Match.tag('UnknownSubcommand', (unknown) => Option.some(unknown.subcommand)),
    Match.orElse(() => Option.none()),
  )

const unrecognizedHintOf = <A, E>(exit: Exit.Exit<A, E>, argv: readonly string[]): string | undefined =>
  Option.getOrUndefined(
    Option.flatMap(cliErrorListOf(exit), (errors) => Arr.findFirst(errors, (error) => argumentHintOf(error, argv))),
  )

const survivorsRejectionOf = <A>(value: A): SurvivorsRejection | undefined =>
  S.is(SurvivorsRejection)(value) ? value : undefined

const present = <A>(value: A | null): A | undefined => (value === null ? undefined : value)

const survivorsReasonOf = (
  survivors: SurvivorsRejection | undefined,
): 'no-report' | 'mismatch' | undefined => survivors?.reason

const survivorsDiagnosticOf = (survivors: SurvivorsRejection | undefined): string | undefined =>
  survivors?.remediation

const omitUnknownFailure = (diagnostic: string): string | undefined =>
  diagnostic === UNKNOWN_FAILURE ? undefined : diagnostic

const hasOnlyInterruptsOf = <A, E>(exit: Exit.Exit<A, E>): boolean =>
  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)

const carriesCliError = <A>(value: A): boolean => value !== undefined && CliError.isCliError(value)

const carriesSchemaError = <A>(value: A): boolean => value !== undefined && S.isSchemaError(value)

const helpErrorCountOf = <A>(value: A): number | undefined =>
  S.is(CliError.ShowHelp)(value) ? value.errors.length : undefined

const verdictExitClassOf = <A>(value: A): ExitClass | undefined =>
  hasVerdict(value) ? Option.getOrUndefined(asExitClass(value.verdict)) : undefined

const successExitClassOf = <A, E>(exit: Exit.Exit<A, E>): ExitClass | undefined =>
  Exit.isSuccess(exit) ? verdictExitClassOf(exit.value) : undefined

const highestExitClassOf = (pending: ReadonlyArray<ExitClass>): ExitClass | null =>
  pending.reduce<ExitClass | null>((highest, candidate) => {
    if (highest === null) {
      return candidate
    }
    return classCode(candidate) > classCode(highest) ? candidate : highest
  }, null)

const gatherRunOutcome = <A, E>(exit: Exit.Exit<A, E>, argv: readonly string[]): RunOutcomeCommand => {
  const value = failureValueOf(exit)
  const survivors = survivorsRejectionOf(value)
  return RunOutcomeCommand.make({
    succeeded: Exit.isSuccess(exit),
    interrupted: hasOnlyInterruptsOf(exit),
    helpErrorCount: helpErrorCountOf(value),
    cliError: carriesCliError(value),
    unrecognized: unrecognizedHintOf(exit, argv),
    survivorsReason: survivorsReasonOf(survivors),
    survivorsDiagnostic: survivorsDiagnosticOf(survivors),
    schemaError: carriesSchemaError(value),
    successExitClass: successExitClassOf(exit),
    highestExitClass: present(highestExitClassOf(collectExitClasses(exit))),
    configDetail: firstConfigErrorDetail(exit),
    diagnostic: omitUnknownFailure(describeFailureOf(exit)),
  })
}

const gatherRunOutcomeOf = <A, E>(input: {
  readonly exit: Exit.Exit<A, E>
  readonly argv: readonly string[]
}): RunOutcomeCommand => gatherRunOutcome(input.exit, input.argv)
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
