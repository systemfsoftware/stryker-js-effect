import { causeText } from '@systemfsoftware/stryker-js-instrumenter'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as CliError from 'effect/unstable/cli/CliError'

import { SurvivorsRejection } from '../Survivors/mod.js'
import {
  classifyRunOutcome as classifyRunOutcomeWorkflow,
  type FailedRunOutcome,
  RunOutcomeCommand,
  type RunOutcomeDecision,
  type RunOutcomeError,
} from '../classify-run-outcome.workflow.js'
import { highestExitClass } from '../exit-classification.js'
import { StreamSchemaVersion } from './stream-version.schema.js'

const CONFIG_CODE = 2
const UNKNOWN_FAILURE = 'Unknown failure'
const MAX_TRAVERSAL_DEPTH = 10

export class ErrorEnvelope extends S.Class<ErrorEnvelope>('ErrorEnvelope')({
  schemaVersion: S.String,
  code: S.Finite,
  error: S.String,
  remediation: S.String,
}) {}

export class RunFailure extends S.TaggedClass<RunFailure>()('RunFailure', {}) {
  static readonly code = (result: Result.Result<RunOutcomeDecision, FailedRunOutcome>): number => {
    const outcome: RunOutcomeDecision | RunOutcomeError = Result.match(result, {
      onSuccess: (success) => success,
      onFailure: (failure) => failure,
    })
    return Match.value(outcome).pipe(
      Match.tag('RunOk', () => 0),
      Match.tag('RunInterrupted', (error) => error.code),
      Match.tag('RunParseFailed', () => CONFIG_CODE),
      Match.tag('RunSurvivorsRejected', () => CONFIG_CODE),
      Match.tag('RunConfigFailed', () => CONFIG_CODE),
      Match.tag('RunFailed', (failed) => failed.code),
      Match.exhaustive,
    )
  }

  static readonly classify = dual<
    <A = unknown, E = unknown>(
      argv: readonly string[],
    ) => (exit: ExitTypes.Exit<A, E>) => Result.Result<RunOutcomeDecision, RunOutcomeError>,
    <A = unknown, E = unknown>(
      exit: ExitTypes.Exit<A, E>,
      argv: readonly string[],
    ) => Result.Result<RunOutcomeDecision, RunOutcomeError>
  >(2, (exit, argv) => classifyRunOutcomeWorkflow(gatherRunOutcome(exit, argv)))

  static readonly text = dual<
    (captured: string) => (error: FailedRunOutcome) => string,
    (error: FailedRunOutcome, captured: string) => string
  >(
    2,
    (error, captured) =>
      Match.value(error).pipe(
        Match.tag('RunParseFailed', (failed) =>
          Option.getOrElse(
            Option.map(Option.fromNullishOr(failed.unrecognized), (value) => `Received unknown argument: '${value}'`),
            () => capturedOrUnknown(captured),
          )),
        Match.tag(
          'RunSurvivorsRejected',
          (failed) => Option.getOrElse(Option.fromNullishOr(failed.diagnostic), () => UNKNOWN_FAILURE),
        ),
        Match.tag('RunInterrupted', () => capturedOrUnknown(captured)),
        Match.tag('RunConfigFailed', (failed) => capturedThenRecorded(captured, failed.detail)),
        Match.tag('RunFailed', (failed) => capturedThenRecorded(captured, failed.diagnostic)),
        Match.exhaustive,
      ),
  )

  static readonly shape = dual<
    (captured: string) => (error: FailedRunOutcome) => ErrorEnvelope,
    (error: FailedRunOutcome, captured: string) => ErrorEnvelope
  >(2, (error, captured) =>
    ErrorEnvelope.make({
      schemaVersion: StreamSchemaVersion.literal,
      code: RunFailure.code(Result.fail(error)),
      error: RunFailure.text(error, captured),
      remediation: remediationText(error),
    }))
}

const SIGNAL_REMEDIATION = 'the run was interrupted by a signal; re-run it to continue'
const PARSE_REMEDIATION = 're-run with --help to see the full usage'
const DEFAULT_REMEDIATION = 'see --reportFile or the verdict envelope on stdout'

const isExitClass = S.is(ExitClass)

const asExitClass = Option.liftPredicate(isExitClass)

const carriesExitClass = <A = unknown>(value: unknown): value is { readonly exitClass: A } =>
  Predicate.isObjectOrArray(value) && 'exitClass' in value

const carriesCause = <A = unknown>(value: unknown): value is { readonly cause: A } =>
  Predicate.isObjectOrArray(value) && 'cause' in value

const carriesReason = <A = unknown>(value: unknown): value is { readonly reason: A } =>
  Predicate.isObjectOrArray(value) && 'reason' in value

const carriesMessageField = <A = unknown>(value: unknown): value is { readonly message: A } =>
  Predicate.isObjectOrArray(value) && 'message' in value

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const exitClassOf = (value: unknown): ExitClass | undefined =>
  Match.value(value).pipe(
    Match.when(carriesExitClass, (carrier) => Option.getOrUndefined(asExitClass(carrier.exitClass))),
    Match.orElse(() => undefined),
  )

const isTraversable = (value: unknown): value is object => Predicate.isObjectOrArray(value)

const isReachableAt = (depth: number) => (value: unknown): value is object =>
  depth <= MAX_TRAVERSAL_DEPTH && isTraversable(value)

const childrenOf = <A>(settled: A): ReadonlyArray<A> =>
  Match.value(settled).pipe(
    Match.when(
      (candidate: A | ReadonlyArray<A>): candidate is ReadonlyArray<A> => Array.isArray(candidate),
      (list) => list,
    ),
    Match.orElse((single) => [single]),
  )

const causeFieldOf = <A = unknown>(value: object): Option.Option<unknown> =>
  Match.value(value).pipe(
    Match.when(carriesCause, (carrier) => Option.fromNullishOr(carrier.cause)),
    Match.orElse(() => Option.none()),
  )

const reachableChildrenOf = <A = unknown>(value: object): ReadonlyArray<A> =>
  Option.match(causeFieldOf<A>(value), {
    onNone: (): ReadonlyArray<A> => [],
    onSome: (settled) => childrenOf<A>(settled),
  })

const reachableOf = (value: unknown, depth: number): ReadonlyArray<object> =>
  Option.match(Option.filter(Option.some(value), isReachableAt(depth)), {
    onNone: () => [],
    onSome: (reachable) => [
      reachable,
      ...Arr.flatMap(reachableChildrenOf(reachable), (child) => reachableOf(child, depth + 1)),
    ],
  })

const causePayloadOf = <E = unknown>(reason: Cause.Reason<E>): E | object | undefined =>
  Match.value(reason).pipe(
    Match.tag('Fail', (failed) => failed.error),
    Match.tag('Die', (died) => Option.getOrUndefined(Option.filter(Option.some(died.defect), isNonNullObject))),
    Match.tag('Interrupt', () => undefined),
    Match.exhaustive,
  )

const failureExitOf = <A = unknown, E = unknown>(exit: ExitTypes.Exit<A, E>): Option.Option<ExitTypes.Failure<A, E>> =>
  Option.filter(Option.some(exit), ExitRuntime.isFailure)

const findExitError = <A = unknown, E = unknown>(failure: ExitTypes.Failure<A, E>): Option.Option<E> =>
  Cause.findErrorOption(failure.cause)

const nonEmptyText = Option.liftPredicate(S.is(S.NonEmptyString))

function reasonOf(value: object): string | undefined {
  const declared = Match.value(value).pipe(
    Match.when(carriesReason, (carrier) => carrier.reason),
    Match.orElse(() => undefined),
  )
  return Option.getOrUndefined(
    Option.map(nonEmptyText(declared), (reason) =>
      Option.match(Option.fromNullishOr(causeTextOf(value)), {
        onNone: () => reason,
        onSome: (detail) => `${reason}: ${detail}`,
      })),
  )
}

function causeTextOf(value: object): string | undefined {
  const cause = Match.value(value).pipe(
    Match.when(carriesCause, (carrier) => carrier.cause),
    Match.orElse(() => undefined),
  )
  return causeText(cause, 1)
}

function firstConfiguredText(value: object): Option.Option<string> {
  const reason = Match.value(value).pipe(
    Match.when(carriesReason, (carrier) => carrier.reason),
    Match.orElse(() => undefined),
  )
  const message = Match.value(value).pipe(
    Match.when(carriesMessageField, (carrier) => carrier.message),
    Match.orElse(() => undefined),
  )
  return Option.orElse(nonEmptyText(reason), () => nonEmptyText(message))
}

const configDetailAt = (value: object): Option.Option<string> =>
  Match.value(exitClassOf(value)).pipe(
    Match.when('ConfigError', () => firstConfiguredText(value)),
    Match.orElse(() => Option.none()),
  )

const firstConfigErrorDetail = <A = unknown, E = unknown>(exit: ExitTypes.Exit<A, E>): string | undefined =>
  Option.getOrUndefined(
    Arr.findFirst(
      Arr.flatMap(Arr.reverse(failurePayloads(exit)), (payload) => reachableOf(payload, 0)),
      (value) => configDetailAt(value),
    ),
  )

const PRIMITIVE_REFINEMENTS = [
  Predicate.isString,
  Predicate.isNumber,
  Predicate.isBoolean,
  Predicate.isBigInt,
  Predicate.isSymbol,
]

const isPrimitiveText = Predicate.some(PRIMITIVE_REFINEMENTS)

const isMessageError = (value: unknown): value is Error =>
  value instanceof Error && value.message.length > 0

const declaresReasonText = (value: unknown): value is object =>
  Match.value(value).pipe(
    Match.when(carriesReason, (carrier) => Option.isSome(nonEmptyText(carrier.reason))),
    Match.orElse(() => false),
  )

const remediationTextOf = <A = unknown>(value: A): Option.Option<string> =>
  S.is(SurvivorsRejection)(value) ? Option.some(value.remediation) : Option.none()

const reasonTextOf = <A = unknown>(value: A): Option.Option<string> =>
  declaresReasonText(value) ? Option.fromNullishOr(reasonOf(value)) : Option.none()

const errorMessageTextOf = <A = unknown>(value: A): Option.Option<string> =>
  isMessageError(value) ? Option.some(value.message) : Option.none()

const primitiveTextOf = <A = unknown>(value: A): Option.Option<string> =>
  isPrimitiveText(value) ? Option.some(String(value)) : Option.none()

const failureValueDescription = <A = unknown>(value: A): Option.Option<string> =>
  Option.orElse(
    Option.orElse(Option.orElse(remediationTextOf(value), () => reasonTextOf(value)), () =>
      errorMessageTextOf(value)),
    () => primitiveTextOf(value),
  )

const failureValue = <A = unknown, E = unknown>(exit: ExitTypes.Exit<A, E>): E | undefined =>
  Option.getOrUndefined(Option.flatMap(failureExitOf(exit), (failure) => findExitError(failure)))

const failureDescriptionOf = <A = unknown, E = unknown>(exit: ExitTypes.Exit<A, E>): Option.Option<string> =>
  Option.orElse(
    Option.orElse(Option.some(failureValueDescription(failureValue(exit))), () =>
      Option.fromNullishOr(firstConfigErrorDetail(exit))),
    () =>
      Option.flatMap(failureExitOf(exit), (failure) => nonEmptyText(Cause.pretty(failure.cause))),
  )

const isShowHelp = <A = unknown>(value: A): value is A & CliError.ShowHelp => S.is(CliError.ShowHelp)(value)

const showHelpErrorsOf = <A = unknown>(value: A): Option.Option<ReadonlyArray<CliError.CliError>> =>
  Match.value(value).pipe(
    Match.when(isShowHelp, (help) => Option.some(showHelpErrors(help))),
    Match.orElse(() => Option.none()),
  )

const singleCliErrorOf = <A = unknown>(value: A): Option.Option<ReadonlyArray<CliError.CliError>> =>
  Match.value(value).pipe(
    Match.when(CliError.isCliError, (cliError) => Option.some([cliError])),
    Match.orElse(() => Option.none()),
  )

function cliErrorList<A = unknown, E = unknown>(
  exit: ExitTypes.Exit<A, E>,
): Option.Option<ReadonlyArray<CliError.CliError>> {
  const value = failureValue(exit)
  return Option.match(showHelpErrorsOf(value), {
    onSome: Option.some,
    onNone: () => singleCliErrorOf(value),
  })
}

function argumentHintOf(error: CliError.CliError, argv: readonly string[]): Option.Option<string> {
  return Match.value(error).pipe(
    Match.tag('UnrecognizedOption', (unrecognized) => Option.some(unrecognizedArgument(argv, unrecognized.option))),
    Match.tag('UnexpectedArgument', (unexpected) => Option.fromNullishOr(unexpected.arguments[0])),
    Match.tag('UnknownSubcommand', (unknown) => Option.some(unknown.subcommand)),
    Match.orElse(() => Option.none()),
  )
}

function unrecognizedArgument(argv: readonly string[], option: string): string {
  return Option.getOrElse(
    Option.filter(followingArgument(argv, option), (argument) => !argument.startsWith('-')),
    () => option,
  )
}

function followingArgument(argv: readonly string[], option: string): Option.Option<string> {
  return Match.value(argv.indexOf(option)).pipe(
    Match.when((at) => at >= 0, (at) => Option.fromNullishOr(argv[at + 1])),
    Match.orElse(() => Option.none()),
  )
}

const presentOf = <A>(value: A | null): A | undefined =>
  Option.getOrUndefined(Option.filter(Option.fromNullishOr(value), (present) => present !== null))

const survivorsReasonOf = (survivors: SurvivorsRejection | undefined): 'no-report' | 'mismatch' | undefined =>
  Option.getOrUndefined(Option.map(Option.fromUndefinedOr(survivors), (rejection) => rejection.reason))

const survivorsDiagnosticOf = (survivors: SurvivorsRejection | undefined): string | undefined =>
  Option.getOrUndefined(Option.map(Option.fromUndefinedOr(survivors), (rejection) => rejection.remediation))

const omitUnknownFailure = (diagnostic: string): string | undefined =>
  Option.getOrUndefined(Option.filter(Option.some(diagnostic), (candidate) => candidate !== UNKNOWN_FAILURE))

const capturedOrUnknown = (captured: string): string =>
  Option.getOrElse(nonEmptyText(captured), () => UNKNOWN_FAILURE)

const hasOnlyInterrupts = <A = unknown, E = unknown>(exit: ExitTypes.Exit<A, E>): boolean =>
  ExitRuntime.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)

const carriesCliError = <A = unknown>(value: A): boolean => value !== undefined && CliError.isCliError(value)

const carriesSchemaError = <A = unknown>(value: A): boolean => value !== undefined && S.isSchemaError(value)

const successExitClassOf = <A = unknown, E = unknown>(exit: ExitTypes.Exit<A, E>): ExitClass | undefined =>
  Option.getOrUndefined(
    Option.flatMap(
      Option.filter(Option.some(exit), ExitRuntime.isSuccess),
      (success) => verdictExitClassOf(success.value),
    ),
  )

const carriesVerdict = <A = unknown>(value: unknown): value is { readonly verdict: A } =>
  Predicate.isObjectOrArray(value) && 'verdict' in value

const verdictExitClassOf = <A = unknown>(value: A): ExitClass | undefined =>
  Match.value(value).pipe(
    Match.when(carriesVerdict, (carrier) => Option.getOrUndefined(asExitClass(carrier.verdict))),
    Match.orElse(() => undefined),
  )

function showHelpErrorCount(help: CliError.ShowHelp): number {
  return help.errors.length
}

const helpErrorCountOf = <A = unknown>(value: A): number | undefined =>
  S.is(CliError.ShowHelp)(value) ? showHelpErrorCount(value) : undefined

function gatherRunOutcome<A = unknown, E = unknown>(
  exit: ExitTypes.Exit<A, E>,
  argv: readonly string[],
): RunOutcomeCommand {
  const value = failureValue(exit)
  const survivors = survivorsRejectionOf(value)
  return RunOutcomeCommand.make({
    succeeded: ExitRuntime.isSuccess(exit),
    interrupted: hasOnlyInterrupts(exit),
    helpErrorCount: helpErrorCountOf(value),
    cliError: carriesCliError(value),
    unrecognized: unrecognizedArgumentOf(exit, argv),
    survivorsReason: survivorsReasonOf(survivors),
    survivorsDiagnostic: survivorsDiagnosticOf(survivors),
    schemaError: carriesSchemaError(value),
    successExitClass: successExitClassOf(exit),
    highestExitClass: presentOf(highestExitClass(collectExitClasses(exit))),
    configDetail: firstConfigErrorDetail(exit),
    diagnostic: omitUnknownFailure(describeFailure(exit)),
  })
}

const collectExitClasses = <A = unknown, E = unknown>(exit: ExitTypes.Exit<A, E>): ReadonlyArray<ExitClass> =>
  Arr.filterMap(
    Arr.flatMap(failurePayloads(exit), (payload) => reachableOf(payload, 0)),
    (value) => Option.fromNullishOr(exitClassOf(value)),
  )

const capturedThenRecorded = (captured: string, recorded: string | undefined): string =>
  Option.getOrElse(
    nonEmptyText(captured),
    () => Option.getOrElse(Option.fromNullishOr(recorded), () => UNKNOWN_FAILURE),
  )

function remediationText(error: FailedRunOutcome): string {
  return Match.value(error).pipe(
    Match.tag('RunInterrupted', () => SIGNAL_REMEDIATION),
    Match.tag('RunParseFailed', () => PARSE_REMEDIATION),
    Match.tag('RunSurvivorsRejected', (failed) =>
      Option.getOrElse(Option.fromNullishOr(failed.diagnostic), () => DEFAULT_REMEDIATION)),
    Match.tag('RunConfigFailed', (failed) =>
      Option.match(Option.fromNullishOr(failed.detail), {
        onSome: (detail) => `check the config file: ${detail}`,
        onNone: () => 'check the config file',
      })),
    Match.tag('RunFailed', () => DEFAULT_REMEDIATION),
    Match.exhaustive,
  )
}
