import { causeText } from '@systemfsoftware/stryker-js-instrumenter'
import { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Formatter from 'effect/Formatter'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as CliError from 'effect/unstable/cli/CliError'
import { SurvivorsRejection } from './Survivors/mod.js'
import {
  classifyRunOutcome as classifyRunOutcomeWorkflow,
  type FailedRunOutcome,
  RunOutcomeCommand,
  type RunOutcomeDecision,
  type RunOutcomeError,
} from './classify-run-outcome.workflow.js'
import { highestExitClass } from './exit-classification.js'
import { STREAM_SCHEMA_VERSION } from './StreamVersion.js'

const CONFIG_CODE = 2
const UNKNOWN_FAILURE = 'Unknown failure'

export function runOutcomeCode(result: Result.Result<RunOutcomeDecision, FailedRunOutcome>): number {
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

export function isExitClass(value: unknown): value is ExitClass {
  return S.is(ExitClass)(value)
}

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

export function exitClassOf<A = unknown>(value: A): ExitClass | undefined {
  if (!carriesExitClass(value)) {
    return undefined
  }
  return Option.getOrUndefined(asExitClass(value.exitClass))
}

const MAX_TRAVERSAL_DEPTH = 10

function isUnseenObject(value: unknown, seen: WeakSet<object>): value is object {
  return Predicate.isObjectOrArray(value) && !seen.has(value)
}

function isReachableValue(value: unknown, depth: number, seen: WeakSet<object>): value is object {
  return depth <= MAX_TRAVERSAL_DEPTH && isUnseenObject(value, seen)
}

function isChildList<A = unknown>(value: unknown): value is ReadonlyArray<A> {
  return Array.isArray(value)
}

function causeChildrenOf<A = unknown>(value: object): ReadonlyArray<A> {
  const cause = carriesCause<A>(value) ? value.cause : undefined
  return Option.match(Option.fromNullishOr(cause), {
    onNone: (): ReadonlyArray<A> => [],
    onSome: (settled) => (isChildList<A>(settled) ? settled : [settled]),
  })
}

function visitReachableValue<A = unknown>(
  value: A,
  depth: number,
  seen: WeakSet<object>,
  visit: (value: object) => void,
): void {
  if (isReachableValue(value, depth, seen)) {
    seen.add(value)
    visit(value)
    causeChildrenOf(value).forEach((child) => visitReachableValue(child, depth + 1, seen, visit))
  }
}

function findReachableValue<V = unknown, A = unknown>(
  value: V,
  depth: number,
  seen: WeakSet<object>,
  read: (value: object) => Option.Option<A>,
): Option.Option<A> {
  if (!isReachableValue(value, depth, seen)) {
    return Option.none()
  }
  seen.add(value)
  return Option.orElse(
    read(value),
    () => Arr.findFirst(causeChildrenOf(value), (child) => findReachableValue(child, depth + 1, seen, read)),
  )
}

function causePayloadOf<E = unknown>(reason: Cause.Reason<E>): E | object | undefined {
  return Cause.isFailReason(reason) ? reason.error : objectPayloadOf(reason)
}

function objectPayloadOf<E = unknown>(reason: Cause.Reason<E>): object | undefined {
  return Option.getOrUndefined(Option.filter(dieDefectOf(reason), isNonNullObject))
}

function dieDefectOf<E = unknown>(reason: Cause.Reason<E>) {
  return Cause.isDieReason(reason) ? Option.some(reason.defect) : Option.none()
}

const failedExit = Option.liftPredicate(Exit.isFailure)

function failurePayloads<A = unknown, E = unknown>(exit: Exit.Exit<A, E>): ReadonlyArray<E | object | undefined> {
  return Option.getOrElse(
    Option.map(failedExit(exit), (failure) => failure.cause.reasons.map(causePayloadOf)),
    () => [],
  )
}

function appendExitClass(value: object, out: Array<ExitClass>): void {
  const declared = exitClassOf(value)
  if (declared !== undefined) {
    out.push(declared)
  }
}

export function collectExitClasses<A = unknown, E = unknown>(exit: Exit.Exit<A, E>): Array<ExitClass> {
  const out: Array<ExitClass> = []
  const seen = new WeakSet<object>()
  failurePayloads(exit).forEach((payload) =>
    visitReachableValue(payload, 0, seen, (value) => appendExitClass(value, out))
  )
  return out
}

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

function configDetailAt(value: object): Option.Option<string> {
  if (exitClassOf(value) !== 'ConfigError') {
    return Option.none()
  }
  return firstConfiguredText(value)
}

function firstConfigErrorDetail<A = unknown, E = unknown>(exit: Exit.Exit<A, E>): string | undefined {
  const seen = new WeakSet<object>()
  // The reasons are read newest-first, the order the previous stack walk visited them in.
  const roots = [...failurePayloads(exit)].reverse()
  return Option.getOrUndefined(
    Arr.findFirst(roots, (root) => findReachableValue(root, 0, seen, configDetailAt)),
  )
}

export function remediationFor<A = unknown, E = unknown>(exit: Exit.Exit<A, E>, code: number): string {
  return buildErrorEnvelope(exit, code, '', []).remediation
}

const PRIMITIVE_REFINEMENTS = [
  Predicate.isString,
  Predicate.isNumber,
  Predicate.isBoolean,
  Predicate.isBigInt,
  Predicate.isSymbol,
]

const isPrimitiveText = Predicate.some(PRIMITIVE_REFINEMENTS)

function isMessageError(value: unknown): value is Error {
  return value instanceof Error && value.message.length > 0
}

function declaresReasonText(value: unknown): value is object {
  return carriesReason(value) && Option.isSome(nonEmptyText(value.reason))
}

function remediationTextOf<A = unknown>(value: A): Option.Option<string> {
  return S.is(SurvivorsRejection)(value) ? Option.some(value.remediation) : Option.none()
}

function reasonTextOf<A = unknown>(value: A): Option.Option<string> {
  return declaresReasonText(value) ? Option.fromNullishOr(reasonOf(value)) : Option.none()
}

function errorMessageTextOf<A = unknown>(value: A): Option.Option<string> {
  return isMessageError(value) ? Option.some(value.message) : Option.none()
}

function primitiveTextOf<A = unknown>(value: A): Option.Option<string> {
  return isPrimitiveText(value) ? Option.some(String(value)) : Option.none()
}

function failureValueDescription<A = unknown>(value: A): Option.Option<string> {
  return remediationTextOf(value).pipe(
    Option.orElse(() => reasonTextOf(value)),
    Option.orElse(() => errorMessageTextOf(value)),
    Option.orElse(() => primitiveTextOf(value)),
  )
}

function failureDescriptionOf<A = unknown, E = unknown>(exit: Exit.Exit<A, E>): Option.Option<string> {
  return failureValueDescription(failureValue(exit)).pipe(
    Option.orElse(() => Option.fromNullishOr(firstConfigErrorDetail(exit))),
    Option.orElse(() => Option.flatMap(failedExit(exit), (failure) => nonEmptyText(Cause.pretty(failure.cause)))),
  )
}

export function describeFailure<A = unknown, E = unknown>(exit: Exit.Exit<A, E>): string {
  return Option.getOrElse(failureDescriptionOf(exit), () => UNKNOWN_FAILURE)
}

export function unrecognizedArgumentOf<A = unknown, E = unknown>(
  exit: Exit.Exit<A, E>,
  argv: readonly string[],
): string | undefined {
  return Option.getOrUndefined(
    cliErrorList(exit).pipe(
      Option.flatMap((errors) => Arr.findFirst(errors, (error) => argumentHintOf(error, argv))),
    ),
  )
}

function showHelpErrors(help: CliError.ShowHelp): ReadonlyArray<CliError.CliError> {
  return help.errors
}

function showHelpErrorsOf<A = unknown>(value: A): Option.Option<ReadonlyArray<CliError.CliError>> {
  return S.is(CliError.ShowHelp)(value) ? Option.some(showHelpErrors(value)) : Option.none()
}

function cliErrorList<A = unknown, E = unknown>(
  exit: Exit.Exit<A, E>,
): Option.Option<ReadonlyArray<CliError.CliError>> {
  const value = failureValue(exit)
  return Option.match(showHelpErrorsOf(value), {
    onSome: (errors) => Option.some(errors),
    onNone: () => (CliError.isCliError(value) ? Option.some([value]) : Option.none()),
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
  return followingArgument(argv, option).pipe(
    Option.filter((argument) => !argument.startsWith('-')),
    Option.getOrElse(() => option),
  )
}

function followingArgument(argv: readonly string[], option: string): Option.Option<string> {
  return Match.value(argv.indexOf(option)).pipe(
    Match.when((at) => at >= 0, (at) => Option.fromNullishOr(argv[at + 1])),
    Match.orElse(() => Option.none()),
  )
}

export function failureValue<A = unknown, E = unknown>(exit: Exit.Exit<A, E>): E | undefined {
  return Option.getOrUndefined(
    Option.flatMap(failedExit(exit), (failure) => Cause.findErrorOption(failure.cause)),
  )
}

export interface ErrorEnvelope {
  readonly schemaVersion: string
  readonly code: number
  readonly error: string
  readonly remediation: string
}

const SIGNAL_REMEDIATION = 'the run was interrupted by a signal; re-run it to continue'
const PARSE_REMEDIATION = 're-run with --help to see the full usage'
const DEFAULT_REMEDIATION = 'see --reportFile or the verdict envelope on stdout'

function verdictExitClass<A = unknown>(value: A): ExitClass | undefined {
  return Predicate.hasProperty('verdict')(value)
    ? Option.getOrUndefined(asExitClass(value.verdict))
    : undefined
}

function successExitClassOf<A = unknown, E = unknown>(exit: Exit.Exit<A, E>): ExitClass | undefined {
  return Exit.isSuccess(exit) ? verdictExitClass(exit.value) : undefined
}

function showHelpErrorCount(help: CliError.ShowHelp): number {
  return help.errors.length
}

function helpErrorCountOf<A = unknown>(value: A): number | undefined {
  return S.is(CliError.ShowHelp)(value) ? showHelpErrorCount(value) : undefined
}

function survivorsRejectionOf<A = unknown>(value: A): SurvivorsRejection | undefined {
  return S.is(SurvivorsRejection)(value) ? value : undefined
}

function present<A>(value: A | null): A | undefined {
  if (value === null) {
    return undefined
  }
  return value
}

function survivorsReasonOf(
  survivors: SurvivorsRejection | undefined,
): 'no-report' | 'mismatch' | undefined {
  if (survivors === undefined) {
    return undefined
  }
  return survivors.reason
}

function survivorsDiagnosticOf(survivors: SurvivorsRejection | undefined): string | undefined {
  if (survivors === undefined) {
    return undefined
  }
  return survivors.remediation
}

function omitUnknownFailure(diagnostic: string): string | undefined {
  if (diagnostic === UNKNOWN_FAILURE) {
    return undefined
  }
  return diagnostic
}

function capturedOrUnknown(captured: string): string {
  return Option.getOrElse(nonEmptyText(captured), () => UNKNOWN_FAILURE)
}

function hasOnlyInterrupts<A = unknown, E = unknown>(exit: Exit.Exit<A, E>): boolean {
  return Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
}

function carriesCliError<A = unknown>(value: A): boolean {
  return value !== undefined && CliError.isCliError(value)
}

function carriesSchemaError<A = unknown>(value: A): boolean {
  return value !== undefined && S.isSchemaError(value)
}

export function gatherRunOutcome<A = unknown, E = unknown>(
  exit: Exit.Exit<A, E>,
  argv: readonly string[],
): RunOutcomeCommand {
  const value = failureValue(exit)
  const survivors = survivorsRejectionOf(value)
  return RunOutcomeCommand.make({
    succeeded: Exit.isSuccess(exit),
    interrupted: hasOnlyInterrupts(exit),
    helpErrorCount: helpErrorCountOf(value),
    cliError: carriesCliError(value),
    unrecognized: unrecognizedArgumentOf(exit, argv),
    survivorsReason: survivorsReasonOf(survivors),
    survivorsDiagnostic: survivorsDiagnosticOf(survivors),
    schemaError: carriesSchemaError(value),
    successExitClass: successExitClassOf(exit),
    highestExitClass: present(highestExitClass(collectExitClasses(exit))),
    configDetail: firstConfigErrorDetail(exit),
    diagnostic: omitUnknownFailure(describeFailure(exit)),
  })
}

function capturedThenRecorded(captured: string, recorded: string | undefined): string {
  return Option.getOrElse(
    nonEmptyText(captured),
    () => Option.getOrElse(Option.fromNullishOr(recorded), () => UNKNOWN_FAILURE),
  )
}

export function errorText(error: FailedRunOutcome, captured: string): string {
  return Match.value(error).pipe(
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
  )
}

function remediationText(error: FailedRunOutcome): string {
  return Match.value(error).pipe(
    Match.tag('RunInterrupted', () => SIGNAL_REMEDIATION),
    Match.tag('RunParseFailed', () => PARSE_REMEDIATION),
    Match.tag('RunSurvivorsRejected', (failed) => {
      if (failed.diagnostic !== undefined) {
        return failed.diagnostic
      }
      return DEFAULT_REMEDIATION
    }),
    Match.tag('RunConfigFailed', (failed) => {
      if (failed.detail !== undefined) {
        return `check the config file: ${failed.detail}`
      }
      return 'check the config file'
    }),
    Match.tag('RunFailed', () => DEFAULT_REMEDIATION),
    Match.exhaustive,
  )
}

export function shapeEnvelope(error: FailedRunOutcome, captured: string): ErrorEnvelope {
  return {
    schemaVersion: STREAM_SCHEMA_VERSION,
    code: runOutcomeCode(Result.fail(error)),
    error: errorText(error, captured),
    remediation: remediationText(error),
  }
}

export function classifyRunOutcome<A = unknown, E = unknown>(
  exit: Exit.Exit<A, E>,
  argv: readonly string[],
): Result.Result<RunOutcomeDecision, RunOutcomeError> {
  return classifyRunOutcomeWorkflow(gatherRunOutcome(exit, argv))
}

export function buildErrorEnvelope<A = unknown, E = unknown>(
  exit: Exit.Exit<A, E>,
  code: number,
  captured: string,
  argv: readonly string[],
): ErrorEnvelope {
  const result = classifyRunOutcome(exit, argv)
  return Result.match(result, {
    onFailure: (failure) => shapeEnvelope(failure, captured),
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('RunParseFailed', (failed) => shapeEnvelope(failed, captured)),
        Match.tag('RunSurvivorsRejected', (failed) => shapeEnvelope(failed, captured)),
        Match.tag('RunConfigFailed', (failed) => shapeEnvelope(failed, captured)),
        Match.tag('RunFailed', (failed) => shapeEnvelope(failed, captured)),
        Match.tag('RunOk', () => ({
          schemaVersion: STREAM_SCHEMA_VERSION,
          code,
          error: capturedOrUnknown(captured),
          remediation: DEFAULT_REMEDIATION,
        })),
        Match.exhaustive,
      ),
  })
}

const capturedConsoleChunks: string[] = []
const countByLabel = new Map<string, number>()
const timeByLabel = new Map<string, bigint>()

function inspectValue<A = unknown>(value: A): string {
  if (typeof value === 'string') {
    return value
  }
  return Formatter.format(value)
}

interface FormatProgress<A = unknown> {
  readonly args: ReadonlyArray<A>
  readonly cursor: number
  readonly text: string
}

const PLACEHOLDER = /(%[sdijfopO%])/g
const PLACEHOLDER_PART = /^%[sdijfopO%]$/

function jsonArgumentText<A = unknown>(argument: A): string {
  try {
    return String(JSON.stringify(argument))
  } catch {
    return '[Circular]'
  }
}

function placeholderText<A = unknown>(placeholder: string, argument: A): string {
  return Match.value(placeholder).pipe(
    Match.when(Match.is('%s'), () => String(argument)),
    Match.when(Match.is('%d', '%i', '%f'), () => Number(argument).toString()),
    Match.when(Match.is('%j'), () => jsonArgumentText(argument)),
    Match.when(Match.is('%o', '%O', '%p'), () => inspectValue(argument)),
    Match.orElse((unmatched) => unmatched),
  )
}

function appendLiteral(progress: FormatProgress, literal: string): FormatProgress {
  return { args: progress.args, cursor: progress.cursor, text: progress.text + literal }
}

function substitutePlaceholder(progress: FormatProgress, placeholder: string): FormatProgress {
  return Match.value(progress.cursor).pipe(
    Match.when(
      (cursor) => cursor < progress.args.length,
      (cursor) => ({
        args: progress.args,
        cursor: cursor + 1,
        text: progress.text + placeholderText(placeholder, progress.args[cursor]),
      }),
    ),
    Match.orElse(() => appendLiteral(progress, placeholder)),
  )
}

function consumePlaceholder(progress: FormatProgress, placeholder: string): FormatProgress {
  return Match.value(placeholder).pipe(
    Match.when(Match.is('%%'), () => appendLiteral(progress, '%')),
    Match.orElse(() => substitutePlaceholder(progress, placeholder)),
  )
}

function formatStep(progress: FormatProgress, part: string): FormatProgress {
  return Match.value(part).pipe(
    Match.when(
      (candidate: string) => PLACEHOLDER_PART.test(candidate),
      (placeholder) => consumePlaceholder(progress, placeholder),
    ),
    Match.orElse((literal) => appendLiteral(progress, literal)),
  )
}

function formatTemplate<A = unknown>(template: string, args: ReadonlyArray<A>): string {
  const parts = template.split(PLACEHOLDER)
  const progress = parts.reduce<FormatProgress>(formatStep, { args, cursor: 0, text: '' })
  const trailing = progress.args.slice(progress.cursor).map((argument) => ` ${inspectValue(argument)}`)
  return progress.text + trailing.join('')
}

function formatArgs<A = unknown>(args: ReadonlyArray<A>): string {
  const [first, ...rest] = args
  return typeof first === 'string' ? formatTemplate(first, rest) : args.map(inspectValue).join(' ')
}

function captureSync<A = unknown>(args: ReadonlyArray<A>): void {
  capturedConsoleChunks.push(formatArgs(args))
}

function captureAssert<A = unknown>(condition: boolean, args: ReadonlyArray<A>): void {
  if (!condition) {
    capturedConsoleChunks.push(`Assertion failed: ${formatArgs(args)}`)
  }
}

const DEFAULT_CONSOLE_LABEL = 'default'

function consoleLabel(label: string | undefined): string {
  return Option.getOrElse(Option.fromNullishOr(label), () => DEFAULT_CONSOLE_LABEL)
}

function incrementCount(key: string): number {
  const next = Option.getOrElse(Option.fromNullishOr(countByLabel.get(key)), () => 0) + 1
  countByLabel.set(key, next)
  return next
}

function captureCount(label: string | undefined): void {
  const key = consoleLabel(label)
  const next = incrementCount(key)
  capturedConsoleChunks.push(`${key}: ${next}`)
}

function elapsedMs(started: bigint, nowNanos: bigint): number {
  return Number(nowNanos - started) / 1_000_000
}

function captureTimeEnd(label: string | undefined, nowNanos: bigint): void {
  const key = consoleLabel(label)
  const started = timeByLabel.get(key)
  if (started !== undefined) {
    timeByLabel.delete(key)
    capturedConsoleChunks.push(`${key}: ${elapsedMs(started, nowNanos)}ms`)
  }
}

function captureTimeLog<A = unknown>(label: string | undefined, args: ReadonlyArray<A>, clock: Clock.Clock): void {
  const key = consoleLabel(label)
  const started = timeByLabel.get(key)
  if (started === undefined) {
    return
  }
  const elapsed = elapsedMs(started, clock.monotonicTimeNanosUnsafe())
  const elapsedText = Match.value(args).pipe(
    Match.when(<B = unknown>(values: ReadonlyArray<B>) => values.length === 0, () => `${key}: ${elapsed}ms`),
    Match.orElse((values) => `${key}: ${elapsed}ms ${formatArgs(values)}`),
  )
  capturedConsoleChunks.push(elapsedText)
}

function captureTrace<A = unknown>(args: ReadonlyArray<A>): void {
  capturedConsoleChunks.push(`Trace: ${formatArgs(args)}\n${new Error().stack ?? ''}`)
}

const makeCapturingConsole = (clock: Clock.Clock): Console.Console => ({
  assert: <A = unknown>(condition: boolean, ...args: ReadonlyArray<A>) => captureAssert(condition, args),
  clear: () => {},
  count: (label) => captureCount(label),
  countReset: (label) => countByLabel.delete(consoleLabel(label)),
  debug: <A = unknown>(...args: ReadonlyArray<A>) => captureSync(args),
  dir: <A = unknown, B = unknown>(item: A, _options?: Record<string, B>) =>
    capturedConsoleChunks.push(Formatter.format(item)),
  dirxml: (item) => capturedConsoleChunks.push(Formatter.format(item)),
  error: <A = unknown>(...args: ReadonlyArray<A>) => captureSync(args),
  group: () => {},
  groupCollapsed: () => {},
  groupEnd: () => {},
  info: <A = unknown>(...args: ReadonlyArray<A>) => captureSync(args),
  log: <A = unknown>(...args: ReadonlyArray<A>) => captureSync(args),
  table: (tabularData) => capturedConsoleChunks.push(Formatter.format(tabularData)),
  time: (label) => timeByLabel.set(consoleLabel(label), clock.monotonicTimeNanosUnsafe()),
  timeEnd: (label) => captureTimeEnd(label, clock.monotonicTimeNanosUnsafe()),
  timeLog: (label, ...args) => captureTimeLog(label, args, clock),
  trace: <A = unknown>(...args: ReadonlyArray<A>) => captureTrace(args),
  warn: <A = unknown>(...args: ReadonlyArray<A>) => captureSync(args),
})

export const machineConsoleLayer: Layer.Layer<never> = Layer.effect(
  Console.Console,
  Clock.clockWith((clock) =>
    Effect.sync(() => {
      resetCapturedConsole()
      return makeCapturingConsole(clock)
    })
  ),
)

export function readCapturedConsole(): string {
  return capturedConsoleChunks.join('\n')
}

export function resetCapturedConsole(): void {
  capturedConsoleChunks.length = 0
  countByLabel.clear()
  timeByLabel.clear()
}
