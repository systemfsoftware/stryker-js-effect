import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as S from 'effect/Schema'
import { RunMutantTested } from './run-event.schema.js'

const STREAM_THRESHOLDS = { high: 100, low: 80 }

const mutantFromStream = (line: RunMutantTested) => {
  const mutant = {
    id: line.id,
    mutatorName: line.mutator,
    status: line.status,
    location: line.location,
  }
  return Option.match(
    Option.liftPredicate(line.replacement, (value) => typeof value === 'string'),
    {
      onNone: () => mutant,
      onSome: (replacement) => ({ ...mutant, replacement }),
    },
  )
}

const streamLines = (text: string) => {
  const decodeLine = S.decodeOption(S.fromJsonString(RunMutantTested))
  return text.split('\n').flatMap((raw) => Option.toArray(decodeLine(raw.trim())))
}

export const reportFromStream = (text: string) => {
  const grouped = Arr.groupBy(streamLines(text), (line) => line.file)
  return Option.map(
    Option.liftPredicate(grouped, (files) => !Record.isEmptyRecord(files)),
    (files) => ({
      schemaVersion: '1.0',
      thresholds: STREAM_THRESHOLDS,
      files: Record.map(files, (lines) => ({
        language: 'javascript',
        source: '',
        mutants: Arr.map(lines, mutantFromStream),
      })),
    }),
  )
}

const STREAM_HEADER = '{"_tag":"stream"}'
const TORN_LINE = '{"_tag":"mutant","id":'

interface RebuiltFile {
  readonly mutants: ReadonlyArray<{ readonly id: string; readonly mutatorName: string }>
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const lineOf = S.encodeOption(S.fromJsonString(RunMutantTested))

  const streamTextOf = (placed: ReadonlyArray<RunMutantTested>) =>
    [STREAM_HEADER, ...Arr.flatMap(placed, (mutant) => Option.toArray(lineOf(mutant))), TORN_LINE].join('\n')
  const reportedKeyOf = (entry: { readonly id: string; readonly mutatorName: string }) =>
    `${entry.id}:${entry.mutatorName}`
  const expectedKeyOf = (mutant: RunMutantTested) => `${mutant.id}:${mutant.mutator}`
  const fileHolds = (reported: RebuiltFile | undefined, group: ReadonlyArray<RunMutantTested>) =>
    reported !== undefined &&
    reported.mutants.map(reportedKeyOf).join('|') === group.map(expectedKeyOf).join('|')
  const regrouped = (placed: ReadonlyArray<RunMutantTested>) => Arr.groupBy(placed, (mutant) => mutant.file)
  const regroupingHolds = (files: Readonly<Record<string, RebuiltFile>>, placed: ReadonlyArray<RunMutantTested>) => {
    const entries = Object.entries(regrouped(placed))
    return entries.length === Object.keys(files).length &&
      entries.every(([file, group]) => fileHolds(files[file], group))
  }

  it.prop(
    '∀m_StreamedMutant_≡RebuiltIntoItsFile',
    { of: [RunMutantTested], subject: reportFromStream },
    (subject, [mutant]) => {
      const rebuilt = Option.flatMap(lineOf(mutant), (line) => subject(`${STREAM_HEADER}\n${line}\n${TORN_LINE}`))
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
      return Option.match(subject(streamTextOf(placed)), {
        onNone: () => mutants.length === 0,
        onSome: (report) => regroupingHolds(report.files, placed),
      })
    },
  )

  it.prop(
    '∀t_NoMutantRecords_≡NoReport',
    {
      of: [S.Union([S.Literal(''), S.Literal('garbage\n'), S.Literal(`${STREAM_HEADER}\n`)])],
      subject: reportFromStream,
    },
    (subject, [text]) => Option.isNone(subject(text)),
  )
}
