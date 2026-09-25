import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import {
  type FailedRunOutcome,
  RunConfigFailed,
  RunFailed,
  RunInterrupted,
  RunOk,
  type RunOutcomeDecision,
  type RunOutcomeError,
  RunParseFailed,
  RunSurvivorsRejected,
} from '../classify-run-outcome.workflow.js'
import { ExitCode } from '../exit-code.schema.js'
import { StreamSchemaVersion } from './stream-version.schema.js'

const CONFIG_CODE = 2
const UNKNOWN_FAILURE = 'Unknown failure'
const SIGNAL_REMEDIATION = 'the run was interrupted by a signal; re-run it to continue'
const PARSE_REMEDIATION = 're-run with --help to see the full usage'
const DEFAULT_REMEDIATION = 'see --reportFile or the verdict envelope on stdout'

export class ErrorEnvelope extends S.Class<ErrorEnvelope>('ErrorEnvelope')({
  schemaVersion: StreamSchemaVersion,
  code: ExitCode,
  error: S.NonEmptyString,
  remediation: S.NonEmptyString,
}) {
  get envelopeText(): string {
    return this.error
  }

  static readonly fromOutcome = (input: { readonly error: FailedRunOutcome; readonly captured: string }) =>
    ErrorEnvelope.make({
      schemaVersion: StreamSchemaVersion.literal,
      code: exitCodeOf(input.error),
      error: failureTextOf(input.error, input.captured),
      remediation: remediationTextOf(input.error),
    })
}

export class RunExitCode extends S.Class<RunExitCode>('RunExitCode')({
  code: ExitCode,
}) {
  static readonly fromOutcome = (outcome: RunOutcomeDecision | RunOutcomeError) =>
    RunExitCode.make({ code: exitCodeOf(outcome) })
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
  Option.getOrElse(
    nonEmptyText(captured),
    () => Option.getOrElse(Option.fromNullishOr(recorded), () => UNKNOWN_FAILURE),
  )

const nonEmptyText = Option.liftPredicate(S.is(S.NonEmptyString))

const failureTextOf = (error: FailedRunOutcome, captured: string) =>
  Match.value(error).pipe(
    Match.tag('RunParseFailed', (failed) =>
      Option.getOrElse(
        Option.map(Option.fromNullishOr(failed.unrecognized), (value) => `Received unknown argument: '${value}'`),
        () => capturedOrUnknown(captured),
      )),
    Match.tag('RunSurvivorsRejected', (failed) =>
      Option.getOrElse(Option.fromNullishOr(failed.diagnostic), () => UNKNOWN_FAILURE)),
    Match.tag('RunInterrupted', () =>
      capturedOrUnknown(captured)),
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
        onSome: (detail) =>
          `check the config file: ${detail}`,
        onNone: () => 'check the config file',
      })),
    Match.tag('RunFailed', () => DEFAULT_REMEDIATION),
    Match.exhaustive,
  )

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const RunOutcomeSchema = S.Union([
    RunOk,
    RunInterrupted,
    RunParseFailed,
    RunSurvivorsRejected,
    RunConfigFailed,
    RunFailed,
  ])

  const codeOf = (outcome: RunOutcomeDecision | RunOutcomeError) => RunExitCode.fromOutcome(outcome).code

  it.prop(
    '∀outcome_RunExitCode_≡FrozenCodes',
    { of: [RunOutcomeSchema], subject: codeOf },
    (subject, [outcome]) =>
      Match.value(outcome).pipe(
        Match.tag('RunOk', () => subject(outcome) === 0),
        Match.tag('RunInterrupted', (interrupted) => subject(outcome) === interrupted.code),
        Match.tag('RunFailed', (failed) => subject(outcome) === failed.code),
        Match.orElse(() => subject(outcome) === CONFIG_CODE),
      ),
  )
}
