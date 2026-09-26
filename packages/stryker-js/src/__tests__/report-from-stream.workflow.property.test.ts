import { describe, it } from '@systemfsoftware/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  reportFromStream,
  ReportFromStreamAbsent,
  ReportFromStreamCommand,
  ReportFromStreamRebuilt,
} from '../report-from-stream.workflow.js'
import { RunMutantTested } from '../run-event.schema.js'

const STREAM_HEADER = '{"_tag":"stream"}'
const TORN_LINE = '{"_tag":"mutant","id":'

const lineOf = S.encodeOption(S.fromJsonString(RunMutantTested))

type RebuiltReport = typeof ReportFromStreamRebuilt.Type.report

const decisionOf = (subject: typeof reportFromStream, text: string) =>
  Result.match(subject(ReportFromStreamCommand.make({ text })), {
    onFailure: () => undefined,
    onSuccess: (decision) => decision,
  })

const reportOf = (subject: typeof reportFromStream, text: string): Option.Option<RebuiltReport> =>
  Option.flatMap(
    Option.fromNullishOr(decisionOf(subject, text)),
    (decision) => S.is(ReportFromStreamRebuilt)(decision) ? Option.some(decision.report) : Option.none(),
  )

const streamTextOf = (mutants: ReadonlyArray<RunMutantTested>): string =>
  [STREAM_HEADER, ...Arr.flatMap(mutants, (mutant) => Option.toArray(lineOf(mutant))), TORN_LINE].join('\n')

describe('reportFromStream', () => {
  it.prop(
    '∀ms_StreamedMutants_≡RebuiltIntoTheirFilesIffAnyMutant',
    { of: [S.Array(RunMutantTested)], subject: reportFromStream },
    (subject, [mutants]) => {
      const rebuilt = reportOf(subject, streamTextOf(mutants))
      return Option.match(rebuilt, {
        onNone: () => mutants.length === 0,
        onSome: (report) =>
          mutants.every((mutant) => {
            const file = report.files[mutant.fileName]
            return file !== undefined &&
              file.mutants.some((entry) => entry.id === mutant.id && entry.mutatorName === mutant.mutatorName)
          }),
      })
    },
  )

  it.prop(
    '∀t_NoMutantRecords_≡Absent',
    { of: [S.Array(RunMutantTested)], subject: reportFromStream },
    (subject, [mutants]) =>
      Arr.isReadonlyArrayNonEmpty(mutants) ||
      S.is(ReportFromStreamAbsent)(decisionOf(subject, `${STREAM_HEADER}\n${TORN_LINE}`)),
  )
})
