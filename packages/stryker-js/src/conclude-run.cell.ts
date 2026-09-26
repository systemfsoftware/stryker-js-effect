/// <reference types="vitest/importMeta" />
import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import type * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as CliError from 'effect/unstable/cli/CliError'

import { RunExit, type RunOutcomeDecision, type RunOutcomeError } from './classify-run-outcome.workflow.js'
import type { ResolvedMode } from './output-mode.schema.js'
import { planRunConclusion, type PlanRunConclusionCommand } from './plan-run-conclusion.workflow.js'
import { runExitCodeFromOutcome } from './reporting/run-failure.js'
import type { RunEventDrain, RunEventStream, RunEventStreamPort } from './run-event-stream.service.js'
import { RunOutcomeCommand } from './RunOutcomeCommand.schema.js'
import {
  RunClassedObservation,
  RunCliErrorObservation,
  RunGenericFailureObservation,
  RunHelpObservation,
  RunInterruptedObservation,
  type RunOutcomeObservation,
  RunSchemaErrorObservation,
  RunSucceededClean,
  RunSucceededVerdict,
  RunSurvivorsRejectedObservation,
} from './RunOutcomeCommand.schema.js'
import { StrykerError } from './stryker-error.schema.js'
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
  Option.map(ErrorText.causeTextOf(hasCause(value) ? value.cause : undefined), (decoded) => decoded.text)

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

const observationOf = <A, E>(
  { exit, value, survivors, argv }: {
    readonly exit: Exit.Exit<A, E>
    readonly value: E | object | undefined
    readonly survivors: SurvivorsRejection | undefined
    readonly argv: readonly string[]
  },
): RunOutcomeObservation => {
  const unrecognized = Option.getOrNull(Option.fromUndefinedOr(unrecognizedHintOf(exit, argv)))
  const configDetail = exit.pipe(firstConfigErrorDetail, Option.fromUndefinedOr, Option.getOrNull)
  const diagnostic = exit.pipe(describeFailureOf, omitUnknownFailure, Option.fromUndefinedOr, Option.getOrNull)

  return Boolean.match(Exit.isSuccess(exit), {
    onTrue: () =>
      exit.pipe(
        successExitClassOf,
        Option.fromUndefinedOr,
        Option.match({
          onNone: () => RunSucceededClean.make({}),
          onSome: (exitClass) => RunSucceededVerdict.make({ exitClass, diagnostic }),
        }),
      ),
    onFalse: () =>
      Boolean.match(hasOnlyInterruptsOf(exit), {
        onTrue: () => RunInterruptedObservation.make({}),
        onFalse: () =>
          Option.match(Option.fromUndefinedOr(helpErrorCountOf(value)), {
            onSome: (errorCount) => RunHelpObservation.make({ errorCount, unrecognized }),
            onNone: () =>
              Boolean.match(carriesCliError(value), {
                onTrue: () => RunCliErrorObservation.make({ unrecognized }),
                onFalse: () =>
                  Option.match(Option.fromUndefinedOr(survivorsReasonOf(survivors)), {
                    onSome: (reason) =>
                      RunSurvivorsRejectedObservation.make({
                        reason,
                        diagnostic: Option.getOrNull(Option.fromUndefinedOr(survivorsDiagnosticOf(survivors))),
                      }),
                    onNone: () =>
                      Boolean.match(carriesSchemaError(value), {
                        onTrue: () => RunSchemaErrorObservation.make({ configDetail }),
                        onFalse: () =>
                          exit.pipe(
                            collectExitClasses,
                            highestExitClassOf,
                            Option.fromUndefinedOr,
                            Option.match({
                              onSome: (exitClass) =>
                                RunClassedObservation.make({ exitClass, configDetail, diagnostic }),
                              onNone: () => RunGenericFailureObservation.make({ diagnostic }),
                            }),
                          ),
                      }),
                  }),
              }),
          }),
      }),
  })
}

export const runOutcomeCommandOf = <A, E>(
  { argv, exit }: { readonly exit: Exit.Exit<A, E>; readonly argv: readonly string[] },
): RunOutcomeCommand => {
  const value = failureValueOf(exit)
  return RunOutcomeCommand.make({
    observation: observationOf({ exit, value, survivors: survivorsRejectionOf(value), argv }),
  })
}

export interface RunConclusion {
  readonly command: RunOutcomeCommand
  readonly outcome: Result.Result<RunOutcomeDecision, RunOutcomeError>
  readonly error: string
}

export interface RunConclusionInput {
  readonly mode: ResolvedMode
  readonly stream: RunEventStream
  readonly basePath: string
  readonly pathService: Path.Path
  readonly runEvents: RunEventStreamPort
  readonly concluded: RunConclusion
}

export type RunConclusionRaw = (typeof PlanRunConclusionCommand)['Encoded'] & {
  readonly conclusion: RunConclusionInput
}

const encodedCommandOf = (
  command: RunOutcomeCommand,
): (typeof RunOutcomeCommand)['Encoded'] => ({
  _tag: 'RunOutcomeCommand',
  observation: command.observation,
})

const readConclusion = Effect.fn('stryker.run_conclusion.read')(function*(
  input: RunConclusionInput,
): Effect.fn.Return<RunConclusionRaw, never, RunEventDrain> {
  const classified = Result.getOrElse(input.concluded.outcome, (interrupted) => interrupted)
  yield* input.stream.open
  return {
    _tag: 'PlanRunConclusionCommand' as const,
    command: encodedCommandOf(input.concluded.command),
    machine: input.mode.mode === 'machine',
    exitCode: runExitCodeFromOutcome(classified).code,
    outcome: classified._tag,
    error: input.concluded.error,
    conclusion: input,
  }
})

export const concludeRunCell = Sandwich.named('stryker.run.conclude')(readConclusion)
  .decide(planRunConclusion)
  .write({
    RunConclusionEmittedOk: (_decision, raw) =>
      Effect.andThen(
        raw.conclusion.runEvents.emitMachineModeOutput({
          stream: raw.conclusion.stream,
          mode: raw.conclusion.mode,
          outcome: raw.conclusion.concluded.outcome,
          basePath: raw.conclusion.basePath,
          pathService: raw.conclusion.pathService,
        }),
        Effect.andThen(raw.conclusion.stream.closeAndDrain, Effect.void),
      ),
    RunConclusionEmittedFailed: (decision, raw) =>
      Effect.andThen(
        raw.conclusion.runEvents.emitMachineModeOutput({
          stream: raw.conclusion.stream,
          mode: raw.conclusion.mode,
          outcome: raw.conclusion.concluded.outcome,
          basePath: raw.conclusion.basePath,
          pathService: raw.conclusion.pathService,
        }),
        Effect.andThen(
          raw.conclusion.stream.closeAndDrain,
          Effect.fail(RunExit.make({ code: decision.exitCode })),
        ),
      ),
    RunConclusionQuietOk: (_decision, raw) => Effect.andThen(raw.conclusion.stream.closeAndDrain, Effect.void),
    RunConclusionQuietFailed: (decision, raw) =>
      Effect.andThen(
        raw.conclusion.stream.closeAndDrain,
        Effect.fail(RunExit.make({ code: decision.exitCode })),
      ),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `the run conclusion command was rejected: ${issue}` })),
  })
if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const severityOf = (exitClass: Plugin.ExitClass): number => Plugin.ExitClass.literals.indexOf(exitClass)

  const classedKeyOf = (command: RunOutcomeCommand): string =>
    S.is(RunClassedObservation)(command.observation)
      ? `${command.observation.exitClass}|${command.observation.configDetail}`
      : 'not-classed'

  const genericDiagnosticOf = (command: RunOutcomeCommand): string | null =>
    S.is(RunGenericFailureObservation)(command.observation) ? command.observation.diagnostic : null

  it.prop(
    '∀text_RunOutcomeCommand_≡PrimitiveFailureDiagnostic',
    { of: [S.String], subject: runOutcomeCommandOf },
    (subject, [text]) => {
      const command = subject({ exit: Exit.fail(text), argv: [] })
      return genericDiagnosticOf(command) === (text === UNKNOWN_FAILURE ? null : text)
    },
  )

  it.prop(
    '∀detail_RunOutcomeCommand_≡ConfigDetail',
    { of: [S.NonEmptyString], subject: runOutcomeCommandOf },
    (subject, [detail]) => {
      const command = subject({ exit: Exit.fail({ exitClass: 'ConfigError', reason: detail }), argv: [] })
      return classedKeyOf(command) === `ConfigError|${detail}`
    },
  )

  it.prop(
    '∀ec_RunOutcomeCommand_≡HighestExitClass',
    { of: [Plugin.ExitClass, Plugin.ExitClass, Plugin.ExitClass], subject: runOutcomeCommandOf },
    (subject, [left, middle, right]) => {
      const exit = Exit.fail({ exitClass: left, cause: { exitClass: middle, cause: { exitClass: right } } })
      const command = subject({ exit, argv: [] })
      return (
        S.is(RunClassedObservation)(command.observation) &&
        severityOf(command.observation.exitClass) ===
          Math.max(severityOf(left), severityOf(middle), severityOf(right))
      )
    },
  )
}
