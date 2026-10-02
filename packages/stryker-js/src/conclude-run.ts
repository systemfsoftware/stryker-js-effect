import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as CliError from 'effect/cli/CliError'
import * as Exit from 'effect/Exit'
import * as Formatter from 'effect/Formatter'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

import {
  type ObservedFailure,
  RunFailedObservation,
  RunHelpObservation,
  RunOutcomeCommand,
  type RunOutcomeObservation,
  RunSucceededClean,
  RunSucceededVerdict,
} from './RunOutcomeCommand.schema.js'

const CLI_BIN = 'stryker'
const MAX_CAUSE_DEPTH = 10

const asEvidence = Option.liftPredicate(S.is(FailureRecord.FailureEvidence))
const asExitClass = Option.liftPredicate(S.is(Plugin.ExitClass))

const textFieldOf = <A, const K extends string>(node: A, key: K): Option.Option<string> =>
  Option.flatMap(
    Option.liftPredicate(node, Predicate.hasProperty(key)),
    (carrier) => Option.liftPredicate(carrier[key], Predicate.isString),
  )

const declaredEvidenceOf = <A>(node: A): Option.Option<FailureRecord.FailureEvidence> =>
  Option.flatMap(
    Option.liftPredicate(node, Predicate.hasProperty('evidence')),
    (carrier) => asEvidence(carrier.evidence),
  )

const causeOf = <A>(node: A, depth: number) =>
  Option.flatMap(
    Option.filter(Option.liftPredicate(node, Predicate.hasProperty('cause')), () => depth < MAX_CAUSE_DEPTH),
    (carrier) => Option.fromUndefinedOr(carrier.cause),
  )

const kindOf = <A>(node: A): string =>
  Option.getOrElse(Option.orElse(textFieldOf(node, '_tag'), () => textFieldOf(node, 'name')), () => typeof node)

const messageOf = <A>(node: A): string =>
  Option.getOrElse(
    Option.orElse(textFieldOf(node, 'message'), () => Option.liftPredicate(node, Predicate.isString)),
    () => Formatter.format(node, { ignoreToString: true }),
  )

const STACK_FRAME = /^\s+at /

const framesOf = (stack: string): Option.Option<string> =>
  Option.liftPredicate(
    Arr.dropWhile(stack.split('\n'), (line) => !STACK_FRAME.test(line)).join('\n'),
    (frames) => frames.length > 0,
  )

const linkOf = <A>(node: A): FailureRecord.CauseLink => ({
  kind: kindOf(node),
  message: messageOf(node),
  stack: Option.getOrNull(Option.flatMap(textFieldOf(node, 'stack'), framesOf)),
})

const causeLinksOf = <A>(node: A, depth: number): ReadonlyArray<FailureRecord.CauseLink> =>
  Arr.prepend(
    Option.match(causeOf(node, depth), {
      onNone: (): ReadonlyArray<FailureRecord.CauseLink> => [],
      onSome: (child) => causeLinksOf(child, depth + 1),
    }),
    linkOf(node),
  )

const evidenceWithin = <A>(node: A, depth: number): Option.Option<FailureRecord.FailureEvidence> =>
  Option.orElse(
    declaredEvidenceOf(node),
    () => Option.flatMap(causeOf(node, depth), (child) => evidenceWithin(child, depth + 1)),
  )

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

const cliErrorsOf = (error: CliError.CliError): ReadonlyArray<CliError.CliError> =>
  S.is(CliError.ShowHelp)(error) ? error.errors : [error]

const argumentsInvalidOf = (error: CliError.CliError, argv: readonly string[]): FailureRecord.FailureEvidence => ({
  _tag: 'ArgumentsInvalid',
  stage: 'cli',
  argument: pipe(
    cliErrorsOf(error),
    Arr.findFirst((each: CliError.CliError) => argumentHintOf(each, argv)),
    Option.getOrNull,
  ),
})

const configInvalidOf = <A>(error: A): FailureRecord.FailureEvidence => ({
  _tag: 'ConfigInvalid',
  stage: 'config',
  detail: messageOf(error),
})

const CATALOG_GAP: FailureRecord.FailureEvidence = { _tag: 'CatalogGap', stage: 'run' }
const INTERRUPTED: FailureRecord.FailureEvidence = { _tag: 'RunInterrupted', stage: 'run' }
const CI_ONLY_EXIT_CODE = 4

interface RunContext {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly traceId: FailureRecord.TraceId | null
}

const observedOf = (
  evidence: FailureRecord.FailureEvidence,
  cause: ReadonlyArray<FailureRecord.CauseLink>,
  context: RunContext,
): ObservedFailure => ({
  record: FailureRecord.recordOf(evidence, {
    cause,
    cwd: context.cwd,
    argv: [CLI_BIN, ...context.argv],
    env: [],
    traceId: context.traceId,
  }),
  exitCode: FailureRecord.FailureCatalog[evidence._tag].exitCode ?? CI_ONLY_EXIT_CODE,
})

const undeclaredEvidenceOf = <A>(payload: A, argv: readonly string[]): FailureRecord.FailureEvidence =>
  Option.getOrElse(
    Option.orElse(
      Option.map(Option.liftPredicate(payload, CliError.isCliError), (error) => argumentsInvalidOf(error, argv)),
      () => Option.map(Option.liftPredicate(payload, S.isSchemaError), configInvalidOf),
    ),
    () => CATALOG_GAP,
  )

const observedFailureOf = <A>(payload: A, context: RunContext): ObservedFailure =>
  observedOf(
    Option.getOrElse(evidenceWithin(payload, 0), () => undeclaredEvidenceOf(payload, context.argv)),
    causeLinksOf(payload, 0),
    context,
  )

const payloadOf = <E>(reason: Cause.Reason<E>) =>
  Cause.isFailReason(reason)
    ? Option.some(reason.error)
    : Option.map(Option.liftPredicate(reason, Cause.isDieReason), (die) => die.defect)

const unpayloadedFailureOf = <E>(cause: Cause.Cause<E>, context: RunContext): ObservedFailure =>
  Cause.hasInterruptsOnly(cause)
    ? observedOf(INTERRUPTED, [], context)
    : observedOf(CATALOG_GAP, [cause.pipe(Cause.pretty, linkOf)], context)

const failuresOf = <E>(cause: Cause.Cause<E>, context: RunContext): Arr.NonEmptyReadonlyArray<ObservedFailure> =>
  Option.getOrElse(
    Arr.match(Arr.flatMap(cause.reasons, (reason) => Option.toArray(payloadOf(reason))), {
      onEmpty: () => Option.none(),
      onNonEmpty: (payloads) => Option.some(Arr.map(payloads, (payload) => observedFailureOf(payload, context))),
    }),
    () => Arr.of(unpayloadedFailureOf(cause, context)),
  )

const isHelpRequest = <E>(cause: Cause.Cause<E>): boolean =>
  Option.exists(Cause.findErrorOption(cause), (error) => S.is(CliError.ShowHelp)(error) && error.errors.length === 0)

const failureObservationOf = <E>(cause: Cause.Cause<E>, context: RunContext): RunOutcomeObservation =>
  isHelpRequest(cause)
    ? RunHelpObservation.make({})
    : RunFailedObservation.make({ failures: failuresOf(cause, context) })

const verdictExitClassOf = <A>(value: A): Option.Option<Plugin.ExitClass> =>
  Option.flatMap(
    Option.liftPredicate(value, Predicate.hasProperty('verdict')),
    (carrier) => asExitClass(carrier.verdict),
  )

const successObservationOf = <A>(value: A): RunOutcomeObservation =>
  Option.match(verdictExitClassOf(value), {
    onNone: () => RunSucceededClean.make({}),
    onSome: (exitClass) => RunSucceededVerdict.make({ exitClass }),
  })

export const runOutcomeCommandOf = <A, E>(input: RunContext & { readonly exit: Exit.Exit<A, E> }): RunOutcomeCommand =>
  RunOutcomeCommand.make({
    observation: Exit.match(input.exit, {
      onSuccess: successObservationOf,
      onFailure: (cause) => failureObservationOf(cause, input),
    }),
  })
