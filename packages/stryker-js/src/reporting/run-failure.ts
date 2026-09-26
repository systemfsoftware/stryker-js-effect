import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import type { FailedRunOutcome, RunOutcomeDecision, RunOutcomeError } from '../classify-run-outcome.workflow.js'
import { ErrorEnvelope, RunExitCode } from './run-failure.schema.js'
import { StreamSchemaVersion } from './stream-version.schema.js'

const CONFIG_CODE = 2
const UNKNOWN_FAILURE = 'Unknown failure'
const SIGNAL_REMEDIATION = 'the run was interrupted by a signal; re-run it to continue'
const PARSE_REMEDIATION = 're-run with --help to see the full usage'
const DEFAULT_REMEDIATION = 'see --reportFile or the verdict envelope on stdout'

export const exitCodeOf = (outcome: RunOutcomeDecision | RunOutcomeError): Plugin.ExitCode =>
  Match.value(outcome).pipe(
    Match.tag('RunOk', () => 0),
    Match.tag('RunInterrupted', (error) => error.code),
    Match.tag('RunParseFailed', () => CONFIG_CODE),
    Match.tag('RunSurvivorsRejected', () => CONFIG_CODE),
    Match.tag('RunConfigFailed', () => CONFIG_CODE),
    Match.tag('RunFailed', (failed) => failed.code),
    Match.exhaustive,
  )

const nonEmptyText = Option.liftPredicate(S.is(S.NonEmptyString))

const capturedOrUnknown = (captured: string) => Option.getOrElse(nonEmptyText(captured), () => UNKNOWN_FAILURE)

const capturedThenRecorded = (captured: string, recorded: string | undefined) =>
  Option.getOrElse(
    nonEmptyText(captured),
    () => Option.getOrElse(Option.fromNullishOr(recorded), () => UNKNOWN_FAILURE),
  )

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

export const errorEnvelopeFromOutcome = (input: {
  readonly error: FailedRunOutcome
  readonly captured: string
}): ErrorEnvelope =>
  ErrorEnvelope.make({
    schemaVersion: StreamSchemaVersion.literal,
    code: exitCodeOf(input.error),
    error: failureTextOf(input.error, input.captured),
    remediation: remediationTextOf(input.error),
  })

export const runExitCodeFromOutcome = (outcome: RunOutcomeDecision | RunOutcomeError): RunExitCode =>
  RunExitCode.make({ code: exitCodeOf(outcome) })
