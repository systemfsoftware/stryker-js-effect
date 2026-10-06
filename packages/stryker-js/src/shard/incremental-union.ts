import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const INCREMENTAL_PART_NAME = /^stryker-incremental.*\.json$/

type Json = S.Schema.Type<typeof S.Json>

const objectOptionOf = (value: Json | undefined): Option.Option<Record<string, Json>> =>
  Option.liftPredicate(
    value,
    (candidate): candidate is Record<string, Json> => Match.record(candidate),
  )

const objectOf = (value: Json | undefined): Record<string, Json> | undefined =>
  Option.getOrUndefined(objectOptionOf(value))

const fieldOf = (object: Record<string, Json> | undefined, key: string): Json | undefined =>
  object === undefined ? undefined : object[key]

const filesOf = (report: Record<string, Json>): Record<string, Json> =>
  Option.getOrElse(Option.fromUndefinedOr(objectOf(fieldOf(report, 'files'))), (): Record<string, Json> => ({}))

const mutantsOfFile = (file: Record<string, Json> | undefined): readonly Json[] =>
  Option.getOrElse(Option.filter(Option.fromUndefinedOr(fieldOf(file, 'mutants')), Array.isArray), () => [])

const mutantIdOf = (mutant: Json): string | undefined =>
  Option.getOrUndefined(
    Option.liftPredicate(fieldOf(objectOf(mutant), 'id'), (id): id is string => typeof id === 'string'),
  )

const mutantEntriesOf = (mutants: readonly Json[]): readonly (readonly [string, Json])[] =>
  mutants.flatMap((mutant) =>
    Option.toArray(Option.map(Option.fromUndefinedOr(mutantIdOf(mutant)), (id) => [id, mutant] as const))
  )

const unionFileOf = (reports: readonly Record<string, Json>[], name: string): readonly [string, Json] => {
  const files = reports.flatMap((report) => Option.toArray(objectOptionOf(filesOf(report)[name])))
  const byMutantId = new Map(files.flatMap((file) => mutantEntriesOf(mutantsOfFile(file))))
  const base = Option.getOrElse(Arr.last(files), (): Record<string, Json> => ({}))
  return [name, { ...base, mutants: [...byMutantId.values()] }]
}

const unionFilesOf = (reports: readonly Record<string, Json>[]): Record<string, Json> =>
  Object.fromEntries(
    [...new Set(reports.flatMap((report) => Object.keys(filesOf(report))))].sort().map((name) =>
      unionFileOf(reports, name)
    ),
  )

const unionTestFilesOf = (reports: readonly Record<string, Json>[]): Record<string, Json> =>
  Object.fromEntries(reports.flatMap((report) => Object.entries(objectOf(fieldOf(report, 'testFiles')) ?? {})))

const decodedReportOf = (text: string): Option.Option<Record<string, Json>> =>
  S.decodeOption(S.fromJsonString(S.Json))(text).pipe(Option.flatMap(objectOptionOf))

export const unionIncrementalReports = (texts: readonly string[]): string | undefined => {
  const reports = texts.flatMap((text) => Option.toArray(decodedReportOf(text)))
  const first = reports[0]
  if (first === undefined) {
    return undefined
  }
  const union = { ...first, files: unionFilesOf(reports), testFiles: unionTestFilesOf(reports) }
  return Option.getOrUndefined(S.encodeOption(S.fromJsonString(S.Json, { space: 2 }))(union))
}
