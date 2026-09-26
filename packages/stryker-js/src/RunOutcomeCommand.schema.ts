import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Exit from 'effect/Exit'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'
import * as CliError from 'effect/unstable/cli/CliError'

import { SurvivorsRejection } from './Survivors/mod.js'

const UNKNOWN_FAILURE = 'Unknown failure'
const MAX_TRAVERSAL_DEPTH = 10

const asExitClass = Option.liftPredicate(S.is(Plugin.ExitClass))

const nonEmptyText = Option.liftPredicate(S.is(S.NonEmptyString))

const failedExit = Option.liftPredicate(Exit.isFailure)

const hasExitClass = Predicate.hasProperty('exitClass')

const hasVerdict = Predicate.hasProperty('verdict')

const hasCause = Predicate.hasProperty('cause')

const hasReason = Predicate.hasProperty('reason')

const hasMessageField = Predicate.hasProperty('message')

const isUnseenObject = <A>(value: A, seen: WeakSet<object>): value is A & object =>
  Predicate.isObjectOrArray(value) && !seen.has(value)
const isReachableValue = <A>(value: A, depth: number, seen: WeakSet<object>): value is A & object =>
  depth <= MAX_TRAVERSAL_DEPTH && isUnseenObject(value, seen)

const causeChildrenOf = (value: object): ReadonlyArray<object> =>
  Option.match(Option.liftPredicate(value, hasCause), {
    onNone: () => [],
    onSome: (carrier) => Arr.filter(Arr.ensure(carrier.cause), Predicate.isObjectOrArray),
  })

const visitReachableValue = <A>(
  value: A,
  depth: number,
  seen: WeakSet<object>,
  visit: (node: object) => void,
): void =>
  Option.match(
    Option.liftPredicate(
      value,
      (candidate): candidate is A & object => isReachableValue(candidate, depth, seen),
    ),
    {
      onSome: (reachable) => {
        seen.add(reachable)
        visit(reachable)
        causeChildrenOf(reachable).forEach((child) => visitReachableValue(child, depth + 1, seen, visit))
      },
      onNone: () => undefined,
    },
  )

const findReachableValue = <A, B>(
  value: A,
  depth: number,
  seen: WeakSet<object>,
  read: (node: object) => Option.Option<B>,
): Option.Option<B> =>
  Option.match(
    Option.liftPredicate(
      value,
      (candidate): candidate is A & object => isReachableValue(candidate, depth, seen),
    ),
    {
      onSome: (reachable) => {
        seen.add(reachable)
        return Option.orElse(
          read(reachable),
          () => Arr.findFirst(causeChildrenOf(reachable), (child) => findReachableValue(child, depth + 1, seen, read)),
        )
      },
      onNone: () => Option.none(),
    },
  )

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

const exitClassOf = <A>(value: A): Plugin.ExitClass | undefined =>
  Option.getOrUndefined(
    Option.flatMap(
      Option.liftPredicate(value, hasExitClass),
      (carrier) => asExitClass(carrier.exitClass),
    ),
  )

const appendExitClass = (value: object, out: Array<Plugin.ExitClass>): void =>
  Option.match(Option.fromUndefinedOr(exitClassOf(value)), {
    onSome: (declared) => {
      out.push(declared)
    },
    onNone: () => undefined,
  })

const collectExitClasses = <A, E>(exit: Exit.Exit<A, E>): Array<Plugin.ExitClass> => {
  const out: Array<Plugin.ExitClass> = []
  const seen = new WeakSet<object>()
  failurePayloads(exit).forEach((payload) =>
    visitReachableValue(payload, 0, seen, (node) => appendExitClass(node, out))
  )
  return out
}

const causeTextOf = <A>(value: A): Option.Option<string> =>
  Option.map(ErrorText.CauseText.fromCause(hasCause(value) ? value.cause : undefined), (decoded) => decoded.text)

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

const reasonTextFieldOf = <A>(value: A): Option.Option<string> =>
  Option.flatMap(Option.liftPredicate(value, hasReason), (carrier) => nonEmptyText(carrier.reason))

const messageTextFieldOf = <A>(value: A): Option.Option<string> =>
  Option.flatMap(Option.liftPredicate(value, hasMessageField), (carrier) => nonEmptyText(carrier.message))

const firstConfiguredText = <A>(value: A): Option.Option<string> =>
  Option.orElse(reasonTextFieldOf(value), () => messageTextFieldOf(value))

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

const declaresReasonText = <A>(value: A): boolean => hasReason(value) && Option.isSome(nonEmptyText(value.reason))

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
  exit.pipe(failedExit, Option.flatMap((failure) => Cause.findErrorOption(failure.cause)), Option.getOrUndefined)

const failureDescriptionOf = <A, E>(exit: Exit.Exit<A, E>): Option.Option<string> =>
  exit.pipe(
    failureValueOf,
    failureValueDescription,
    Option.orElse(() => exit.pipe(firstConfigErrorDetail, Option.fromNullishOr)),
    Option.orElse(() =>
      exit.pipe(failedExit, Option.flatMap((failure) => failure.cause.pipe(Cause.pretty, nonEmptyText)))
    ),
  )

const describeFailureOf = <A, E>(exit: Exit.Exit<A, E>): string =>
  Option.getOrElse(failureDescriptionOf(exit), () => UNKNOWN_FAILURE)

const showHelpErrors = (help: CliError.ShowHelp): ReadonlyArray<CliError.CliError> => help.errors

const showHelpErrorsOf = <A>(value: A): Option.Option<ReadonlyArray<CliError.CliError>> =>
  Option.map(Option.liftPredicate(value, S.is(CliError.ShowHelp)), showHelpErrors)

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
  exit.pipe(
    cliErrorListOf,
    Option.flatMap((errors) => Arr.findFirst(errors, (error) => argumentHintOf(error, argv))),
    Option.getOrUndefined,
  )

const survivorsRejectionOf = <A>(value: A): SurvivorsRejection | undefined =>
  S.is(SurvivorsRejection)(value) ? value : undefined

const survivorsReasonOf = (
  survivors: SurvivorsRejection | undefined,
): 'no-report' | 'mismatch' | undefined => survivors?.reason

const survivorsDiagnosticOf = (survivors: SurvivorsRejection | undefined): string | undefined => survivors?.remediation

const omitUnknownFailure = (diagnostic: string): string | undefined =>
  diagnostic === UNKNOWN_FAILURE ? undefined : diagnostic

const hasOnlyInterruptsOf = <A, E>(exit: Exit.Exit<A, E>): boolean =>
  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)

const carriesCliError = <A>(value: A): boolean => value !== undefined && CliError.isCliError(value)

const carriesSchemaError = <A>(value: A): boolean => value !== undefined && S.isSchemaError(value)

const helpErrorCountOf = <A>(value: A): number | undefined =>
  S.is(CliError.ShowHelp)(value) ? value.errors.length : undefined

const verdictExitClassOf = <A>(value: A): Plugin.ExitClass | undefined =>
  hasVerdict(value) ? Option.getOrUndefined(asExitClass(value.verdict)) : undefined

const successExitClassOf = <A, E>(exit: Exit.Exit<A, E>): Plugin.ExitClass | undefined =>
  Exit.isSuccess(exit) ? verdictExitClassOf(exit.value) : undefined

const bySeverity: Order.Order<Plugin.ExitClass> = Order.mapInput(
  Order.Number,
  (exitClass: Plugin.ExitClass) => Plugin.ExitClass.literals.indexOf(exitClass),
)

const highestExitClassOf = (pending: ReadonlyArray<Plugin.ExitClass>): Plugin.ExitClass | undefined =>
  Option.getOrUndefined(Arr.last(Arr.sort(pending, bySeverity)))

const runOutcomeCommandOf = <A, E>(
  { argv, exit }: { readonly exit: Exit.Exit<A, E>; readonly argv: readonly string[] },
): RunOutcomeCommand => {
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
    highestExitClass: exit.pipe(collectExitClasses, highestExitClassOf),
    configDetail: firstConfigErrorDetail(exit),
    diagnostic: exit.pipe(describeFailureOf, omitUnknownFailure),
  })
}

export class RunOutcomeCommand extends S.TaggedClass<RunOutcomeCommand>()('RunOutcomeCommand', {
  succeeded: S.Boolean,
  interrupted: S.Boolean,
  helpErrorCount: S.optional(S.Finite),
  cliError: S.Boolean,
  unrecognized: S.optional(S.String),
  survivorsReason: S.optional(S.Literals(['no-report', 'mismatch'])),
  survivorsDiagnostic: S.optional(S.String),
  schemaError: S.Boolean,
  successExitClass: S.optional(Plugin.ExitClass),
  highestExitClass: S.optional(Plugin.ExitClass),
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

  static readonly fromExit = runOutcomeCommandOf
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Equal = await import('effect/Equal')

  const severityOf = (exitClass: Plugin.ExitClass): number => Plugin.ExitClass.literals.indexOf(exitClass)

  it.prop(
    '∀text_RunOutcomeCommand_≡PrimitiveFailureDiagnostic',
    { of: [S.String], subject: runOutcomeCommandOf },
    (subject, [text]) => {
      const command = subject({ exit: Exit.fail(text), argv: [] })
      const observed = [
        command.succeeded,
        command.interrupted,
        command.cliError,
        command.helpErrorCount,
        command.unrecognized,
        command.highestExitClass,
        command.configDetail,
        command.diagnostic,
      ]
      const expected = [
        false,
        false,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        text === UNKNOWN_FAILURE ? undefined : text,
      ]
      return observed.every((field, index) => field === expected[index])
    },
  )

  it.prop(
    '∀detail_RunOutcomeCommand_≡ConfigDetail',
    { of: [S.NonEmptyString], subject: runOutcomeCommandOf },
    (subject, [detail]) =>
      subject({ exit: Exit.fail({ exitClass: 'ConfigError', reason: detail }), argv: [] }).configDetail === detail,
  )

  it.prop(
    '∀ec_RunOutcomeCommand_≡HighestExitClass',
    { of: [Plugin.ExitClass, Plugin.ExitClass, Plugin.ExitClass], subject: runOutcomeCommandOf },
    (subject, [left, middle, right]) => {
      const exit = Exit.fail({ exitClass: left, cause: { exitClass: middle, cause: { exitClass: right } } })
      const command = subject({ exit, argv: [] })
      return Equal.equals(
        Option.map(Option.fromUndefinedOr(command.highestExitClass), severityOf),
        Option.some(Math.max(severityOf(left), severityOf(middle), severityOf(right))),
      )
    },
  )
}
