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

  static readonly fromExit = (input: { readonly exit: unknown; readonly argv: readonly string[] }) =>
    gatherRunOutcomeOf(input)
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

const gatherRunOutcomeOf = (input: { readonly exit: unknown; readonly argv: readonly string[] }) => {
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
