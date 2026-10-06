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

const costsOf = (report: Record<string, Json>): Record<string, Json> =>
  Option.getOrElse(Option.fromUndefinedOr(objectOf(fieldOf(report, 'costs'))), (): Record<string, Json> => ({}))

const hasActualMs = (entry: Json): boolean =>
  Option.getOrElse(
    Option.map(
      Option.flatMap(objectOptionOf(entry), (object) => Option.fromUndefinedOr(fieldOf(object, 'actualMs'))),
      (actualMs) => typeof actualMs === 'number' && Number.isFinite(actualMs),
    ),
    () => false,
  )

const preferMeasuredCost = (left: Json | undefined, right: Json): Json =>
  Option.getOrElse(
    Option.orElse(
      Option.orElse(Option.filter(Option.fromUndefinedOr(left), hasActualMs), () =>
        Option.filter(Option.fromUndefinedOr(right), hasActualMs)),
      () =>
        Option.fromUndefinedOr(left),
    ),
    () => right,
  )

const unionCostsOf = (reports: readonly Record<string, Json>[]): Record<string, Json> =>
  Object.fromEntries(
    reports
      .flatMap((report) => Object.entries(costsOf(report)))
      .reduce<Map<string, Json>>(
        (byMutantId, [mutantId, entry]) =>
          byMutantId.set(mutantId, preferMeasuredCost(byMutantId.get(mutantId), entry)),
        new Map<string, Json>(),
      ),
  )

const decodedReportOf = (text: string): Option.Option<Record<string, Json>> =>
  S.decodeOption(S.fromJsonString(S.Json))(text).pipe(Option.flatMap(objectOptionOf))

export const unionIncrementalReports = (texts: readonly string[]): string | undefined => {
  const reports = texts.flatMap((text) => Option.toArray(decodedReportOf(text)))
  const first = reports[0]
  if (first === undefined) {
    return undefined
  }
  const union = {
    ...first,
    files: unionFilesOf(reports),
    costs: unionCostsOf(reports),
    testFiles: unionTestFilesOf(reports),
  }
  return Option.getOrUndefined(S.encodeOption(S.fromJsonString(S.Json, { space: 2 }))(union))
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arbitrary = await import('effect/Arbitrary')
  const Equal = await import('effect/Equal')
  const Match = await import('effect/Match')
  const { MutantCost } = await import('../MutantCost.schema.js')

  type CostEntry = typeof MutantCost.Type

  const costEntryArb = Arbitrary.schema(MutantCost)
  const costEntries = Arbitrary.array(costEntryArb)

  const parsedReportOf = (text: string) =>
    S.decodeOption(S.fromJsonString(S.Struct({ incrementalVersion: S.String, costs: S.Record(S.String, MutantCost) })))(
      text,
    )

  const reportTextOf = (version: string, costs: Record<string, CostEntry>): string =>
    JSON.stringify({ incrementalVersion: version, costs })

  const entriesByParity = (entries: readonly CostEntry[], parity: number): Record<string, CostEntry> =>
    Object.fromEntries(
      entries.flatMap((entry, index) => (index % 2 === parity ? [[`m${index}`, entry] as const] : [])),
    )

  const disjointCase = Arbitrary.map(costEntries, (entries) => ({
    first: reportTextOf('first', entriesByParity(entries, 0)),
    second: reportTextOf('second', entriesByParity(entries, 1)),
    expected: Object.fromEntries(entries.map((entry, index) => [`m${index}`, entry] as const)),
  }))

  const expectedWinnerOf = (first: CostEntry, second: CostEntry): CostEntry =>
    Match.value({ firstMeasured: first.actualMs !== null, secondMeasured: second.actualMs !== null }).pipe(
      Match.when({ firstMeasured: true }, () => first),
      Match.when({ secondMeasured: true }, () => second),
      Match.orElse(() => first),
    )

  const overlapCase = Arbitrary.map(
    Arbitrary.all({ first: costEntryArb, second: costEntryArb }),
    ({ first, second }) => ({
      reports: [reportTextOf('first', { m0: first }), reportTextOf('second', { m0: second })],
      expected: expectedWinnerOf(first, second),
    }),
  )

  it.prop(
    '∀ms_DisjointCosts_≡UnionKeepsEveryShardEntry',
    { of: [disjointCase], subject: unionIncrementalReports },
    (subject, [shards]) =>
      Option.match(parsedReportOf(subject([shards.first, shards.second]) ?? ''), {
        onNone: () => false,
        onSome: (merged) => merged.incrementalVersion === 'first' && Equal.equals(merged.costs, shards.expected),
      }),
  )

  it.prop(
    '∀ab_OverlappingCosts_≡MeasuredEntryWinsAndFirstWinsTies',
    { of: [overlapCase], subject: unionIncrementalReports },
    (subject, [overlap]) =>
      Option.match(parsedReportOf(subject(overlap.reports) ?? ''), {
        onNone: () => false,
        onSome: (merged) => Equal.equals(merged.costs['m0'], overlap.expected),
      }),
  )
}
