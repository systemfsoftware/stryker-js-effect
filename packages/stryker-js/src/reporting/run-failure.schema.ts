import { CauseText } from '@systemfsoftware/stryker-js-instrumenter'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Cause from 'effect/Cause'
import * as Exit from 'effect/Exit'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'
import * as CliError from 'effect/unstable/cli/CliError'

import { SurvivorsRejection } from '../Survivors/mod.js'
import { ClassifyExitCommand, classifyExit } from '../classify-exit.workflow.js'
import {
  RunConfigFailed,
  RunFailed,
  RunInterrupted,
  RunOk,
  RunOutcomeCommand,
  RunParseFailed,
  RunSurvivorsRejected,
  type FailedRunOutcome,
  type RunOutcomeDecision,
  type RunOutcomeError,
} from '../classify-run-outcome.workflow.js'
import { StreamSchemaVersion } from './stream-version.schema.js'

const CONFIG_CODE = 2
const UNKNOWN_FAILURE = 'Unknown failure'
const MAX_TRAVERSAL_DEPTH = 10
const SIGNAL_REMEDIATION = 'the run was interrupted by a signal; re-run it to continue'
const PARSE_REMEDIATION = 're-run with --help to see the full usage'
const DEFAULT_REMEDIATION = 'see --reportFile or the verdict envelope on stdout'

export class ErrorEnvelope extends S.Class<ErrorEnvelope>('ErrorEnvelope')({
  schemaVersion: S.String,
  code: S.Finite,
  error: S.String,
  remediation: S.String,
}) {}

const FailedRunOutcomeSchema = S.Union([
  RunInterrupted,
  RunParseFailed,
  RunSurvivorsRejected,
  RunConfigFailed,
  RunFailed,
])

const RunOutcomeSchema = S.Union([RunOk, RunInterrupted, RunParseFailed, RunSurvivorsRejected, RunConfigFailed, RunFailed])

const FailureOutcomeInput = S.Struct({ error: FailedRunOutcomeSchema, captured: S.String })

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

const carriesVerdict = <A = unknown>(value: unknown): value is { readonly verdict: A } =>
  Predicate.isObjectOrArray(value) && 'verdict' in value

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isChildList = (value: unknown): value is ReadonlyArray<unknown> => Array.isArray(value)

const isMessageError = (value: unknown): value is Error => value instanceof Error && value.message.length > 0

const isShowHelp = <A = unknown>(value: A): value is A & CliError.ShowHelp => S.is(CliError.ShowHelp)(value)

const isSurvivorsRejection = S.is(SurvivorsRejection)

const nonEmptyText = Option.liftPredicate(S.is(S.NonEmptyString))

const asExit = (value: unknown) => Option.filter(Option.some(value), Exit.isExit)

const exitClassOf = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(carriesExitClass, (carrier) => Option.getOrUndefined(asExitClass(carrier.exitClass))),
    Match.orElse(() => undefined),
  )

const verdictExitClassOf = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(carriesVerdict, (carrier) => Option.getOrUndefined(asExitClass(carrier.verdict))),
    Match.orElse(() => undefined),
  )

const successExitClassOf = (exit: unknown) =>
  Option.getOrUndefined(
    Option.flatMap(Option.filter(asExit(exit), Exit.isSuccess), (success) => verdictExitClassOf(success.value)),
  )

const declaredReasonOf = (value: object) =>
  Match.value(value).pipe(
    Match.when(carriesReason, (carrier) => carrier.reason),
    Match.orElse(() => undefined),
  )

const declaredMessageOf = (value: object) =>
  Match.value(value).pipe(
    Match.when(carriesMessageField, (carrier) => carrier.message),
    Match.orElse(() => undefined),
  )

const unknownCauseOf = (value: object) =>
  Match.value(value).pipe(
    Match.when(carriesCause, (carrier) => carrier.cause),
    Match.orElse(() => undefined),
  )

const causeTextOf = (value: object) => Option.getOrUndefined(S.decodeUnknownOption(CauseText)(unknownCauseOf(value)))

const reasonOf = (value: object) =>
  Option.getOrUndefined(
    Option.map(nonEmptyText(declaredReasonOf(value)), (reason) =>
      Option.match(Option.fromNullishOr(causeTextOf(value)), {
        onNone: () => reason,
        onSome: (detail) => `${reason}: ${detail}`,
      })),
  )

const firstConfiguredTextOf = (value: object) =>
  Option.orElse(nonEmptyText(declaredReasonOf(value)), () => nonEmptyText(declaredMessageOf(value)))

const configDetailAt = (value: object) =>
  Match.value(exitClassOf(value)).pipe(
    Match.when('ConfigError', () => firstConfiguredTextOf(value)),
    Match.orElse(() => Option.none()),
  )

interface FoundWalk<A> {
  readonly seen: ReadonlyArray<object>
  readonly found: Option.Option<A>
}

const reachableAt = (value: unknown, depth: number, seen: ReadonlyArray<object>) =>
  Option.filter(
    Option.filter(Option.some(value), Predicate.isObjectOrArray),
    (candidate) => depth <= MAX_TRAVERSAL_DEPTH && !seen.includes(candidate),
  )

const causeChildrenOf = (value: object): ReadonlyArray<unknown> =>
  Option.match(Option.filter(Option.some(value), carriesCause), {
    onNone: () => [],
    onSome: (carrier) =>
      Option.match(Option.fromNullishOr(carrier.cause), {
        onNone: () => [],
        onSome: (settled) =>
          Match.value(settled).pipe(
            Match.when(isChildList, (list) => list),
            Match.orElse((single) => [single]),
          ),
      }),
  })

const findWalkOf = <A>(
  value: unknown,
  depth: number,
  seen: ReadonlyArray<object>,
  read: (node: object) => Option.Option<A>,
): FoundWalk<A> =>
  Option.match(reachableAt(value, depth, seen), {
    onNone: () => ({ seen, found: Option.none() }),
    onSome: (node) =>
      Option.match(read(node), {
        onSome: (found) => ({ seen: [...seen, node], found: Option.some(found) }),
        onNone: () =>
          causeChildrenOf(node).reduce<FoundWalk<A>>(
            (walked, child) =>
              Boolean.match(Option.isSome(walked.found), {
                onTrue: () => walked,
                onFalse: () => findWalkOf(child, depth + 1, walked.seen, read),
              }),
            { seen: [...seen, node], found: Option.none() },
          ),
      }),
  })

interface ExitClassWalk {
  readonly seen: ReadonlyArray<object>
  readonly classes: ReadonlyArray<ExitClass>
}

const collectExitClassesFrom = (value: unknown, depth: number, seen: ReadonlyArray<object>): ExitClassWalk =>
  Option.match(reachableAt(value, depth, seen), {
    onNone: () => ({ seen, classes: [] }),
    onSome: (node) =>
      causeChildrenOf(node).reduce<ExitClassWalk>(
        (walked, child) => {
          const next = collectExitClassesFrom(child, depth + 1, walked.seen)
          return { seen: next.seen, classes: [...walked.classes, ...next.classes] }
        },
        {
          seen: [...seen, node],
          classes: Option.toArray(Option.fromNullishOr(exitClassOf(node))),
        },
      ),
  })

const collectExitClassesOf = (exit: unknown): ReadonlyArray<ExitClass> =>
  failurePayloadsOf(exit).reduce<ExitClassWalk>(
    (walked, payload) => {
      const next = collectExitClassesFrom(payload, 0, walked.seen)
      return { seen: next.seen, classes: [...walked.classes, ...next.classes] }
    },
    { seen: [], classes: [] },
  ).classes

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

const failurePayloadsOf = (exit: unknown): ReadonlyArray<unknown> =>
  Option.match(Option.filter(asExit(exit), Exit.isFailure), {
    onNone: () => [],
    onSome: (failure) => failure.cause.reasons.map(causePayloadOf),
  })

const firstConfigErrorDetailOf = (exit: unknown) =>
  Option.getOrUndefined(
    Arr.reverse(failurePayloadsOf(exit)).reduce<FoundWalk<string>>(
      (walked, root) =>
        Boolean.match(Option.isSome(walked.found), {
          onTrue: () => walked,
          onFalse: () => findWalkOf(root, 0, walked.seen, configDetailAt),
        }),
      { seen: [], found: Option.none() },
    ).found,
  )

const declaresReasonText = (value: unknown): value is object =>
  carriesReason(value) && Option.isSome(nonEmptyText(value.reason))

const reasonTextOf = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(declaresReasonText, (carrier) => Option.fromNullishOr(reasonOf(carrier))),
    Match.orElse(() => Option.none<string>()),
  )

const survivorsRemediationOf = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(isSurvivorsRejection, (rejection) => Option.some(rejection.remediation)),
    Match.orElse(() => Option.none()),
  )

const errorMessageTextOf = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(isMessageError, (error) => Option.some(error.message)),
    Match.orElse(() => Option.none()),
  )

const isPrimitiveText = Predicate.some([
  Predicate.isString,
  Predicate.isNumber,
  Predicate.isBoolean,
  Predicate.isBigInt,
  Predicate.isSymbol,
])

const primitiveTextOf = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(isPrimitiveText, (primitive) => Option.some(String(primitive))),
    Match.orElse(() => Option.none()),
  )

const failureValueDescriptionOf = (value: unknown) =>
  Option.orElse(
    Option.orElse(
      Option.orElse(survivorsRemediationOf(value), () => reasonTextOf(value)),
      () => errorMessageTextOf(value),
    ),
    () => primitiveTextOf(value),
  )

const failureValueOf = (exit: unknown) =>
  Option.getOrUndefined(
    Option.flatMap(Option.filter(asExit(exit), Exit.isFailure), (failure) => Cause.findErrorOption(failure.cause)),
  )

const failureDescriptionOf = (exit: unknown) =>
  Option.orElse(
    Option.orElse(
      failureValueDescriptionOf(failureValueOf(exit)),
      () => Option.fromNullishOr(firstConfigErrorDetailOf(exit)),
    ),
    () =>
      Option.flatMap(Option.filter(asExit(exit), Exit.isFailure), (failure) =>
        nonEmptyText(Cause.pretty(failure.cause))),
  )

const describeFailureOf = (exit: unknown) => Option.getOrElse(failureDescriptionOf(exit), () => UNKNOWN_FAILURE)

const showHelpErrorsOf = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(isShowHelp, (help) => Option.some(help.errors)),
    Match.orElse(() => Option.none()),
  )

const cliErrorListOf = (exit: unknown) => {
  const value = failureValueOf(exit)
  return Option.match(showHelpErrorsOf(value), {
    onSome: Option.some,
    onNone: () =>
      Match.value(value).pipe(
        Match.when(CliError.isCliError, (cliError) => Option.some([cliError])),
        Match.orElse(() => Option.none()),
      ),
  })
}

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

const unrecognizedHintOf = (exit: unknown, argv: readonly string[]) =>
  Option.getOrUndefined(
    Option.flatMap(cliErrorListOf(exit), (errors) => Arr.findFirst(errors, (error) => argumentHintOf(error, argv))),
  )

const survivorsReasonOf = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(isSurvivorsRejection, (rejection) => Option.some(rejection.reason)),
    Match.orElse(() => Option.none()),
  )

const hasOnlyInterruptsOf = (exit: unknown) =>
  Option.match(Option.filter(asExit(exit), Exit.isFailure), {
    onSome: (failure) => Cause.hasInterruptsOnly(failure.cause),
    onNone: () => false,
  })

const carriesCliError = (value: unknown) => value !== undefined && CliError.isCliError(value)

const carriesSchemaError = (value: unknown) => value !== undefined && S.isSchemaError(value)

const helpErrorCountOf = (value: unknown) =>
  Match.value(value).pipe(
    Match.when(isShowHelp, (help) => Option.some(help.errors.length)),
    Match.orElse(() => Option.none<number>()),
  )

const omitUnknownFailure = (diagnostic: string) =>
  Option.getOrUndefined(Option.filter(Option.some(diagnostic), (candidate) => candidate !== UNKNOWN_FAILURE))

const highestExitClassOf = (pending: ReadonlyArray<ExitClass>) =>
  Result.match(
    classifyExit(new ClassifyExitCommand({ pending: [...pending], signal: null, score: null, breakingThreshold: null })),
    {
      onSuccess: (decision) => Option.fromNullishOr(decision.highestClass),
      onFailure: () => Option.none<ExitClass>(),
    },
  )

const runOutcomeCommandOf = (input: { readonly exit: unknown; readonly argv: readonly string[] }) => {
  const { exit, argv } = input
  const value = failureValueOf(exit)
  return RunOutcomeCommand.make({
    succeeded: Option.isSome(Option.filter(asExit(exit), Exit.isSuccess)),
    interrupted: hasOnlyInterruptsOf(exit),
    helpErrorCount: helpErrorCountOf(value),
    cliError: carriesCliError(value),
    unrecognized: unrecognizedHintOf(exit, argv),
    survivorsReason: survivorsReasonOf(value),
    survivorsDiagnostic: survivorsRemediationOf(value),
    schemaError: carriesSchemaError(value),
    successExitClass: successExitClassOf(exit),
    highestExitClass: Option.getOrUndefined(highestExitClassOf(collectExitClassesOf(exit))),
    configDetail: firstConfigErrorDetailOf(exit),
    diagnostic: omitUnknownFailure(describeFailureOf(exit)),
  })
}

const exitCodeOf = (outcome: RunOutcomeDecision | RunOutcomeError) =>
  Match.value(outcome).pipe(
    Match.tag('RunOk', () => 0),
    Match.tag('RunInterrupted', (error) => error.code),
    Match.tag('RunParseFailed', () => CONFIG_CODE),
    Match.tag('RunSurvivorsRejected', () => CONFIG_CODE),
    Match.tag('RunConfigFailed', () => CONFIG_CODE),
    Match.tag('RunFailed', (failed) => failed.code),
    Match.exhaustive,
  )

const capturedOrUnknown = (captured: string) => Option.getOrElse(nonEmptyText(captured), () => UNKNOWN_FAILURE)

const capturedThenRecorded = (captured: string, recorded: string | undefined) =>
  Option.getOrElse(nonEmptyText(captured), () => Option.getOrElse(Option.fromNullishOr(recorded), () => UNKNOWN_FAILURE))

const failureTextOf = (error: FailedRunOutcome, captured: string) =>
  Match.value(error).pipe(
    Match.tag('RunParseFailed', (failed) =>
      Option.getOrElse(
        Option.map(Option.fromNullishOr(failed.unrecognized), (value) => `Received unknown argument: '${value}'`),
        () => capturedOrUnknown(captured),
      )),
    Match.tag('RunSurvivorsRejected', (failed) =>
      Option.getOrElse(Option.fromNullishOr(failed.diagnostic), () => UNKNOWN_FAILURE)),
    Match.tag('RunInterrupted', () => capturedOrUnknown(captured)),
    Match.tag('RunConfigFailed', (failed) => capturedThenRecorded(captured, failed.detail)),
    Match.tag('RunFailed', (failed) => capturedThenRecorded(captured, failed.diagnostic)),
    Match.exhaustive,
  )

const remediationTextOf = (error: FailedRunOutcome) =>
  Match.value(error).pipe(
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

const errorEnvelopeOf = (error: FailedRunOutcome, captured: string) =>
  ErrorEnvelope.make({
    schemaVersion: StreamSchemaVersion.literal,
    code: exitCodeOf(error),
    error: failureTextOf(error, captured),
    remediation: remediationTextOf(error),
  })

export const RunExitCodeFromOutcome = RunOutcomeSchema.pipe(
  S.decodeTo(S.Finite, {
    decode: SGetter.transform(exitCodeOf),
    encode: SGetter.forbiddenEncoding,
  }),
)

export const FailureTextFromOutcome = FailureOutcomeInput.pipe(
  S.decodeTo(S.String, {
    decode: SGetter.transform(({ error, captured }) => failureTextOf(error, captured)),
    encode: SGetter.forbiddenEncoding,
  }),
)

export const ErrorEnvelopeFromOutcome = FailureOutcomeInput.pipe(
  S.decodeTo(ErrorEnvelope, {
    decode: SGetter.transform(({ error, captured }) => errorEnvelopeOf(error, captured)),
    encode: SGetter.forbiddenEncoding,
  }),
)

const RunOutcomeInput = S.Struct({ exit: S.Unknown, argv: S.Array(S.String) })

export const RunOutcomeCommandFromExit = RunOutcomeInput.pipe(
  S.decodeTo(RunOutcomeCommand, {
    decode: SGetter.transform(runOutcomeCommandOf),
    encode: SGetter.forbiddenEncoding,
  }),
)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')

  it.prop('∀outcome_RunExitCodeFromOutcome_DecodesFinite', [RunOutcomeSchema], ([outcome]) =>
    Result.isSuccess(S.decodeResult(RunExitCodeFromOutcome)(outcome)))

  it.prop('∀outcome_RunExitCodeFromOutcome_KeepsRunOkAndInterruptCodes', [RunOutcomeSchema], ([outcome]) => {
    const decoded = S.decodeResult(RunExitCodeFromOutcome)(outcome)
    return Result.match(decoded, {
      onSuccess: (code) =>
        Match.value(outcome).pipe(
          Match.tag('RunOk', () => code === 0),
          Match.tag('RunInterrupted', (error) => code === error.code),
          Match.orElse(() => code !== 0),
        ),
      onFailure: () => false,
    })
  })

  it.prop('∀error_captured_FailureTextFromOutcome_NonEmpty', [FailedRunOutcomeSchema, S.String], ([error, captured]) =>
    Result.match(S.decodeResult(FailureTextFromOutcome)({ error, captured }), {
      onSuccess: (text) => text.length > 0,
      onFailure: () => false,
    }))

  it.prop('∀error_captured_ErrorEnvelopeFromOutcome_CarriesFrozenSchemaVersion', [FailedRunOutcomeSchema, S.String], ([error, captured]) =>
    Result.match(S.decodeResult(ErrorEnvelopeFromOutcome)({ error, captured }), {
      onSuccess: (envelope) => envelope.schemaVersion === StreamSchemaVersion.literal,
      onFailure: () => false,
    }))

  it.prop('∀error_captured_ErrorEnvelopeFromOutcome_ErrorFieldEqualsTextTransformation', [FailedRunOutcomeSchema, S.String], ([error, captured]) =>
    Result.match(S.decodeResult(FailureTextFromOutcome)({ error, captured }), {
      onFailure: () => false,
      onSuccess: (text) =>
        Result.match(S.decodeResult(ErrorEnvelopeFromOutcome)({ error, captured }), {
          onFailure: () => false,
          onSuccess: (envelope) => envelope.error === text,
        }),
    }))

  it.prop('∀error_captured_ErrorEnvelopeFromOutcome_CodeEqualsExitCodeTransformation', [FailedRunOutcomeSchema, S.String], ([error, captured]) =>
    Result.match(S.decodeResult(RunExitCodeFromOutcome)(error), {
      onFailure: () => false,
      onSuccess: (code) =>
        Result.match(S.decodeResult(ErrorEnvelopeFromOutcome)({ error, captured }), {
          onFailure: () => false,
          onSuccess: (envelope) => envelope.code === code,
        }),
    }))

  it.prop('∀error_captured_TextTransformations_ForbidEncoding', [FailedRunOutcomeSchema, S.String], ([error, captured]) =>
    Result.match(S.decodeResult(ErrorEnvelopeFromOutcome)({ error, captured }), {
      onFailure: () => false,
      onSuccess: (envelope) =>
        Result.isFailure(S.encodeResult(FailureTextFromOutcome)(captured)) &&
        Result.isFailure(S.encodeResult(ErrorEnvelopeFromOutcome)(envelope)) &&
        Result.isFailure(S.encodeResult(RunExitCodeFromOutcome)(error)),
    }))

  it.prop('∀error_captured_ErrorEnvelopeFromOutcome_DecodesAsErrorEnvelope', [FailedRunOutcomeSchema, S.String], ([error, captured]) =>
    Result.match(S.decodeResult(ErrorEnvelopeFromOutcome)({ error, captured }), {
      onFailure: () => false,
      onSuccess: (envelope) => S.is(ErrorEnvelope)(envelope),
    }))

  it.prop('∀exit_argv_RunOutcomeCommandFromExit_DecodesTotal', [S.String], ([text]) =>
    Option.match(S.decodeOption(RunOutcomeCommandFromExit)({ exit: Exit.fail(text), argv: [] }), {
      onNone: () => false,
      onSome: (command) =>
        S.is(RunOutcomeCommand)(command) && command.succeeded === false && command.interrupted === false &&
        command.highestExitClass === undefined && command.configDetail === undefined &&
        (text === UNKNOWN_FAILURE ? command.diagnostic === undefined : command.diagnostic === text),
    }))

  it.prop('∀command_RunOutcomeCommandFromExit_ForbidEncoding', [S.String], ([text]) =>
    Option.match(S.decodeOption(RunOutcomeCommandFromExit)({ exit: Exit.fail(text), argv: [] }), {
      onNone: () => false,
      onSome: (command) => Result.isFailure(S.encodeResult(RunOutcomeCommandFromExit)(command)),
    }))
}
