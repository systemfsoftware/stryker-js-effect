import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitReuseSource,
  AdmitReuseSourceCommand,
  type AdmitReuseSourceDecision,
  ReuseSourceAbsent,
  ReuseSourceDiscarded,
  ReuseSourceKept,
} from '../admit-reuse-source.workflow.js'
import { type ReuseReport, ReuseReportSchema } from '../IncrementalDiff.schema.js'
import { INCREMENTAL_CACHE_VERSION } from '../verdict-semantics.js'

const VERSION = INCREMENTAL_CACHE_VERSION

const admittedOfText = (text: string): AdmitReuseSourceDecision =>
  Result.getOrThrow(
    admitReuseSource(AdmitReuseSourceCommand.make({ text, expectedIncrementalVersion: VERSION })),
  )

const reportTextOf = (version: string, report: ReuseReport): string =>
  JSON.stringify({ incrementalVersion: version, ...report })

const withoutRememberedTextOf = (report: ReuseReport): string =>
  JSON.stringify({
    incrementalVersion: VERSION,
    ...report,
    files: Object.fromEntries(
      Object.entries(report.files).map(([file, entry]) => [
        file,
        {
          ...entry,
          mutants: entry.mutants.map((mutant) =>
            Object.fromEntries(Object.entries(mutant).filter(([key]) => key !== 'remembered'))
          ),
        },
      ]),
    ),
  })

describe('admitReuseSource', () => {
  it.prop(
    '∀vr_VersionAndReport_≡AReuseTextIsKeptExactlyWhenItsVersionMatches',
    {
      of: [S.String, ReuseReportSchema],
      subject: (version: string, report: ReuseReport) => admittedOfText(reportTextOf(version, report)),
    },
    (subject, [version, report]) => {
      const decision = subject(version, report)
      return version === VERSION
        ? S.is(ReuseSourceKept)(decision)
        : S.is(ReuseSourceDiscarded)(decision) && decision.reason === 'cacheLayoutChanged' &&
          decision.actual === version && decision.expected === VERSION
    },
  )

  it.prop(
    '∀r_Report_≡AReuseTextWhoseMutantsLackTheRememberedMarkerIsUndecodable',
    {
      of: [ReuseReportSchema],
      subject: (report: ReuseReport) => admittedOfText(withoutRememberedTextOf(report)),
    },
    (subject, [report]) => {
      const decision = subject(report)
      const mutantCount = Object.values(report.files).flatMap((file) => file.mutants).length
      return mutantCount === 0
        ? S.is(ReuseSourceKept)(decision)
        : S.is(ReuseSourceDiscarded)(decision) && decision.reason === 'undecodable'
    },
  )

  it.prop(
    '∀c_Command_≡OnlyAnEmptyTextIsAbsent',
    { of: [AdmitReuseSourceCommand], subject: admitReuseSource },
    (subject, [command]) =>
      S.is(ReuseSourceAbsent)(subject(command).pipe(Result.getOrThrow)) === (command.text.length === 0),
  )
})
