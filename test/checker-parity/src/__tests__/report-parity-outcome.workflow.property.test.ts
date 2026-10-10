import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ParityBroken, ParityHolds, Violation } from '../compare-sides.workflow.js'
import { DriverFailure } from '../DriverFailure.schema.js'
import {
  CompareFinished,
  DriverFailedReport,
  ParityBrokenReport,
  ParityHeldReport,
  type ParityOutcomeReport,
  ProjectShard,
  reportParityOutcome,
  ReportParityOutcomeCommand,
} from '../report-parity-outcome.workflow.js'

const VIOLATION_KINDS = Violation.members.length

const reportOf = (
  subject: typeof reportParityOutcome,
  outcome: CompareFinished | DriverFailure,
  githubActions: boolean,
  runId: string,
): ParityOutcomeReport => Result.getOrThrow(subject(ReportParityOutcomeCommand.make({ outcome, githubActions, runId })))

const finishedOf = (
  decision: ParityBroken | ParityHolds,
  summaryFile: string,
  projectShards: ReadonlyArray<ProjectShard>,
): CompareFinished =>
  CompareFinished.make({ decision, lineCount: 0, shards: 1, summaryFile, projectShards: [...projectShards] })

const WORKFLOW_ERROR_COMMAND = /^::error [a-z]+=[^,:\r\n]*(?:,[a-z]+=[^,:\r\n]*)*::[^\r\n]*$/u

const isSingleLineError = (annotation: string): boolean => WORKFLOW_ERROR_COMMAND.test(annotation)

describe('reportParityOutcome', () => {
  it.prop(
    '∀b_ParityBroken_≡ExitOneOneAnnotationPerKindFailSummary',
    { of: [ParityBroken, S.String, S.String, S.Array(ProjectShard)], subject: reportParityOutcome },
    (subject, [broken, runId, summaryFile, projectShards]) => {
      const report = reportOf(subject, finishedOf(broken, summaryFile, projectShards), true, runId)
      const codes = Arr.dedupe(broken.violations.map((violation) => violation.code))
      return S.is(ParityBrokenReport)(report) &&
        report.annotations.length === codes.length && report.annotations.length <= VIOLATION_KINDS &&
        report.annotations.every(isSingleLineError) &&
        codes.every((code) =>
          report.annotations.filter((annotation) => annotation.includes(`title=checker-parity ${code}::`)).length === 1
        ) &&
        report.stepSummary.startsWith('### checker-parity: FAIL')
    },
  )

  it.prop(
    '∀b_ParityBrokenOutsideActions_≡ExitOneNoAnnotations',
    { of: [ParityBroken, S.String, S.String, S.Array(ProjectShard)], subject: reportParityOutcome },
    (subject, [broken, runId, summaryFile, projectShards]) => {
      const report = reportOf(subject, finishedOf(broken, summaryFile, projectShards), false, runId)
      return S.is(ParityBrokenReport)(report) && report.annotations.length === 0
    },
  )

  it.prop(
    '∀h_ParityHolds_≡ExitZeroPassSummary',
    { of: [ParityHolds, S.Boolean, S.String, S.String, S.Array(ProjectShard)], subject: reportParityOutcome },
    (subject, [held, githubActions, runId, summaryFile, projectShards]) => {
      const report = reportOf(subject, finishedOf(held, summaryFile, projectShards), githubActions, runId)
      return S.is(ParityHeldReport)(report) && report.annotations.length === 0 &&
        report.stepSummary.startsWith('### checker-parity: pass')
    },
  )

  it.prop(
    '∀f_DriverFailure_≡ExitTwoNamingCodeAndNextAction',
    { of: [DriverFailure, S.Boolean, S.String], subject: reportParityOutcome },
    (subject, [failure, githubActions, runId]) => {
      const report = reportOf(subject, failure, githubActions, runId)
      return S.is(DriverFailedReport)(report) &&
        report.stderr[0] === `${failure.code}: ${failure.reason}` &&
        report.stderr.includes(`next action: ${failure.nextAction}`) &&
        report.annotations.length === (githubActions ? 1 : 0) && report.annotations.every(isSingleLineError) &&
        report.stepSummary.startsWith(`### checker-parity: ERROR (${failure.code})`)
    },
  )
})
