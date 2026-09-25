import * as Option from 'effect/Option'
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
  const grouped = streamLines(text).reduce(
    (groups, line) => groups.set(line.file, [...(groups.get(line.file) ?? []), mutantFromStream(line)]),
    new Map<string, ReturnType<typeof mutantFromStream>[]>(),
  )
  return Option.map(
    Option.liftPredicate(grouped, (files) => files.size > 0),
    (files) => ({
      schemaVersion: '1.0',
      thresholds: STREAM_THRESHOLDS,
      files: Object.fromEntries(
        [...files].map(([file, mutants]) => [file, { language: 'javascript', source: '', mutants }]),
      ),
    }),
  )
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const lineOf = S.encodeOption(S.fromJsonString(RunMutantTested))
  const TORN_LINE = '{"_tag":"mutant","id":'

  it.prop(
    '∀m_StreamedMutant_≡RebuiltIntoItsFile',
    { of: [RunMutantTested], subject: reportFromStream },
    (subject, [mutant]) => {
      const rebuilt = Option.flatMap(lineOf(mutant), (line) => subject(`{"_tag":"stream"}\n${line}\n${TORN_LINE}`))
      const inFile = Option.flatMap(rebuilt, (report) => Option.fromNullishOr(report.files[mutant.file]))
      const mutants = Option.match(inFile, { onNone: () => [], onSome: (file) => file.mutants })
      return mutants.some((entry) => entry.id === mutant.id && entry.mutatorName === mutant.mutator)
    },
  )
}
