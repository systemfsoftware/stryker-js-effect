import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ParityBroken, ParityHolds, Violation } from '../compare-sides.workflow.js'
import { DriverFailure } from '../DriverFailure.schema.js'
import { LegScope, ScopeSettings } from '../Parity.schema.js'
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
  legs: ReadonlyArray<LegScope> = [],
): CompareFinished =>
  CompareFinished.make({
    decision,
    lineCount: 0,
    shards: 1,
    summaryFile,
    projectShards: [...projectShards],
    legs: [...legs],
  })

const encodeLeg = S.encodeResult(LegScope)

const prLegOf = (leg: LegScope, settings: ScopeSettings): LegScope =>
  LegScope.make({ ...Result.getOrThrow(encodeLeg(leg)), scope: 'pr', settings })

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
    '∀l_PullRequestLegs_≡SummaryNamesSeedSizeAndCheckedTotal',
    {
      of: [ParityHolds, S.Boolean, S.String, S.String, S.Array(ProjectShard), LegScope, LegScope, ScopeSettings],
      subject: reportParityOutcome,
    },
    (subject, [held, githubActions, runId, summaryFile, projectShards, first, second, settings]) => {
      const legs = [prLegOf(first, settings), prLegOf(second, settings)]
      const finished = finishedOf(held, summaryFile, projectShards, legs)
      const summary = reportOf(subject, finished, githubActions, runId).stepSummary
      return summary.includes(`seed \`${settings.seed}\``) &&
        summary.includes(`drift ${settings.perProject} per project over ${settings.driftProjects} project(s)`) &&
        summary.includes(`at most ${settings.perChangedFile} per changed file`) &&
        summary.includes(`${first.checkedMutants + second.checkedMutants} mutants checked`)
    },
  )

  it.prop(
    '∀h_TypeQueryProjects_≡SummaryCountsEveryProjectsAnswersAndRefusals',
    { of: [ParityHolds, S.Boolean, S.String, S.String, S.Array(ProjectShard)], subject: reportParityOutcome },
    (subject, [held, githubActions, runId, summaryFile, projectShards]) => {
      const summary = reportOf(subject, finishedOf(held, summaryFile, projectShards), githubActions, runId).stepSummary
      return held.summary.typeQuery.projects.every((share) =>
        summary.includes(
          `  - ${share.project}: ${share.queried} answered, ${share.notAssignable} NotAssignable, ${share.unknown} Unknown`,
        ) &&
        summary.includes(`${share.refusedFiles} file(s) refused (${share.refusedMutants} mutants)`) &&
        Object.entries(share.unknownReasons).every(([reason, count]) =>
          count === 0 || summary.includes(`${reason} ${count}`)
        )
      )
    },
  )

  it.prop(
    '∀h_TypeQuerySiteKinds_≡SummaryCountsEveryKindsAnswers',
    { of: [ParityHolds, S.Boolean, S.String, S.String, S.Array(ProjectShard)], subject: reportParityOutcome },
    (subject, [held, githubActions, runId, summaryFile, projectShards]) => {
      const summary = reportOf(subject, finishedOf(held, summaryFile, projectShards), githubActions, runId).stepSummary
      const { expression } = held.summary.typeQuery.answersBySiteKind
      const functionBody = held.summary.typeQuery.answersBySiteKind['function-body']
      const countsText = (
        counts: { readonly assignable: number; readonly notAssignable: number; readonly unknown: number },
      ): string => `${counts.assignable} Assignable, ${counts.notAssignable} NotAssignable, ${counts.unknown} Unknown`
      return summary.includes(`expression ${countsText(expression)}`) &&
        summary.includes(`function-body ${countsText(functionBody)}`)
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
