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

const streamReportOf = (subject: typeof reportFromStream, text: string): Option.Option<RebuiltReport> =>
  Result.match(subject(ReportFromStreamCommand.make({ text })), {
    onFailure: () => Option.none(),
    onSuccess: (decision) => (S.is(ReportFromStreamRebuilt)(decision) ? Option.some(decision.report) : Option.none()),
  })

describe('reportFromStream', () => {
  it.prop(
    '∀m_StreamedMutant_≡RebuiltIntoItsFile',
    { of: [RunMutantTested], subject: reportFromStream },
    (subject, [mutant]) => {
      const rebuilt = Option.flatMap(
        lineOf(mutant),
        (line) => streamReportOf(subject, `${STREAM_HEADER}\n${line}\n${TORN_LINE}`),
      )
      const inFile = Option.flatMap(rebuilt, (report) => Option.fromNullishOr(report.files[mutant.file]))
      const mutants = Option.match(inFile, { onNone: () => [], onSome: (file) => file.mutants })
      return mutants.some((entry) => entry.id === mutant.id && entry.mutatorName === mutant.mutator)
    },
  )

  it.prop(
    '∀ms_StreamedMutants_≡RegroupedIntoTheirFiles',
    { of: [S.Array(RunMutantTested)], subject: reportFromStream },
    (subject, [mutants]) => {
      const placed = Arr.map(mutants, (mutant, index) =>
        RunMutantTested.make({
          id: mutant.id,
          status: mutant.status,
          file: `src/file-${index % 2}.ts`,
          location: mutant.location,
          mutator: mutant.mutator,
          replacement: mutant.replacement,
          completed: mutant.completed,
          total: mutant.total,
        }))
      const text = [
        STREAM_HEADER,
        ...Arr.flatMap(placed, (mutant) => Option.toArray(lineOf(mutant))),
        TORN_LINE,
      ].join('\n')
      const grouped = Arr.groupBy(placed, (mutant) => mutant.file)
      return Option.match(streamReportOf(subject, text), {
        onNone: () => placed.length === 0,
        onSome: (report) => {
          const entries = Object.entries(grouped)
          return entries.length === Object.keys(report.files).length &&
            entries.every(([file, group]) => {
              const reported = report.files[file]
              return reported !== undefined &&
                reported.mutants.map((entry) => `${entry.id}:${entry.mutatorName}`).join('|') ===
                  group.map((mutant) => `${mutant.id}:${mutant.mutator}`).join('|')
            })
        },
      })
    },
  )

  it.prop(
    '∀t_NoMutantRecords_≡Absent',
    {
      of: [S.Union([S.Literal(''), S.Literal('garbage\n'), S.Literal(`${STREAM_HEADER}\n`)])],
      subject: reportFromStream,
    },
    (subject, [text]) =>
      Result.match(subject(ReportFromStreamCommand.make({ text })), {
        onFailure: () => false,
        onSuccess: (decision) => S.is(ReportFromStreamAbsent)(decision),
      }),
  )
})
