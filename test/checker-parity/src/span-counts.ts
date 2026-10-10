import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import type * as S from 'effect/Schema'

import type { AttributeValue, KeyValues, OtlpExportRequest, Resource } from './Otlp.schema.js'

export const CHECK_SPAN_NAME = 'typescript-checker.compiler.check'

export const COUNTS_SCHEMA_VERSION_ATTRIBUTE = 'typescript.counts.schema_version'

export const COUNTS_SCHEMA_VERSION = 1

const FALLBACK_KEY = /^typescript\.importer_shortcut\.fallback\.(.+)\.count$/u
const SERVICE_NAME_ATTRIBUTE = 'service.name'
const MUTANTS_IDS_ATTRIBUTE = 'stryker.mutants.ids'

export type AttributeScalar = string | number | boolean

export interface SpanRecord {
  readonly serviceName: string
  readonly name: string
  readonly attributes: HashMap.HashMap<string, AttributeScalar>
}

const finiteOf = (value: string | number): Option.Option<number> => Option.liftPredicate(Number(value), Number.isFinite)

const scalarOf = (value: S.Schema.Type<typeof AttributeValue>): Option.Option<AttributeScalar> =>
  Option.fromUndefinedOr(value.stringValue).pipe(
    Option.orElse(() => Option.flatMap(Option.fromUndefinedOr(value.intValue), finiteOf)),
    Option.orElse(() => Option.fromUndefinedOr(value.doubleValue)),
    Option.orElse(() => Option.fromUndefinedOr(value.boolValue)),
  )

const attributesOf = (
  pairs: Option.Option<S.Schema.Type<typeof KeyValues>>,
): HashMap.HashMap<string, AttributeScalar> =>
  HashMap.fromIterable(
    Arr.getSomes(
      Option.getOrElse(pairs, Arr.empty).map((pair) =>
        Option.map(scalarOf(pair.value), (scalar) => [pair.key, scalar] as const)
      ),
    ),
  )

const serviceNameOf = (resource: Option.Option<S.Schema.Type<typeof Resource>>): string =>
  attributesOf(Option.flatMap(resource, (present) => Option.fromUndefinedOr(present.attributes))).pipe(
    HashMap.get(SERVICE_NAME_ATTRIBUTE),
    Option.filter(Predicate.isString),
    Option.getOrElse(() => ''),
  )

export const spanRecordsOf = (request: S.Schema.Type<typeof OtlpExportRequest>): ReadonlyArray<SpanRecord> =>
  request.resourceSpans.flatMap((resourceSpans) =>
    Option.getOrElse(Option.fromUndefinedOr(resourceSpans.scopeSpans), Arr.empty).flatMap((scopeSpans) =>
      scopeSpans.spans.map((span) => ({
        serviceName: serviceNameOf(Option.fromUndefinedOr(resourceSpans.resource)),
        name: span.name,
        attributes: attributesOf(Option.fromUndefinedOr(span.attributes)),
      }))
    )
  )

export interface SpanCounts {
  readonly snapshotUpdates: number
  readonly resplices: number
  readonly tceBuilds: number
  readonly tceMs: number
  readonly importerShortcuts: number
  readonly fallbacks: Readonly<Record<string, number>>
  readonly checkSpans: number
}

const namesMutant = (span: SpanRecord, mutantIds: HashSet.HashSet<string>): boolean =>
  HashMap.get(span.attributes, MUTANTS_IDS_ATTRIBUTE).pipe(
    Option.filter(Predicate.isString),
    Option.exists((ids) => ids.split(',').some((id) => HashSet.has(mutantIds, id))),
  )

export const projectCheckSpans: {
  (
    serviceName: string,
    mutantIds: HashSet.HashSet<string>,
  ): (spans: ReadonlyArray<SpanRecord>) => ReadonlyArray<SpanRecord>
  (spans: ReadonlyArray<SpanRecord>, serviceName: string, mutantIds: HashSet.HashSet<string>): ReadonlyArray<SpanRecord>
} = dual(
  3,
  (
    spans: ReadonlyArray<SpanRecord>,
    serviceName: string,
    mutantIds: HashSet.HashSet<string>,
  ): ReadonlyArray<SpanRecord> =>
    spans.filter((span) =>
      Boolean.every([span.serviceName === serviceName, span.name === CHECK_SPAN_NAME, namesMutant(span, mutantIds)])
    ),
)

const numberAttribute = (span: SpanRecord, key: string): number =>
  HashMap.get(span.attributes, key).pipe(Option.filter(Predicate.isNumber), Option.getOrElse(() => 0))

const sumAttribute = (spans: ReadonlyArray<SpanRecord>, key: string): number =>
  spans.reduce((total, span) => total + numberAttribute(span, key), 0)

const fallbackEntryOf = (key: string, value: AttributeScalar): Option.Option<readonly [string, number]> =>
  Option.fromNullishOr(FALLBACK_KEY.exec(key)).pipe(
    Option.flatMap((match) => Option.fromUndefinedOr(match[1])),
    Option.flatMap((clause) => Option.map(Option.liftPredicate(value, Predicate.isNumber), (count) => [clause, count])),
  )

const fallbackCountsOf = (spans: ReadonlyArray<SpanRecord>): Readonly<Record<string, number>> =>
  Arr.getSomes(
    spans.flatMap((span) => Arr.map(HashMap.toEntries(span.attributes), ([key, value]) => fallbackEntryOf(key, value))),
  )
    .reduce<Readonly<Record<string, number>>>(
      (counts, [clause, count]) => ({
        ...counts,
        [clause]: Option.getOrElse(Option.fromUndefinedOr(counts[clause]), () => 0) + count,
      }),
      {},
    )

export const countsOfSpans = (spans: ReadonlyArray<SpanRecord>): SpanCounts => ({
  snapshotUpdates: sumAttribute(spans, 'typescript.snapshot_updates.count'),
  resplices: sumAttribute(spans, 'typescript.resplices.count'),
  tceBuilds: sumAttribute(spans, 'typescript.tce_builds.count'),
  tceMs: sumAttribute(spans, 'typescript.tce.ms'),
  importerShortcuts: sumAttribute(spans, 'typescript.importer_shortcut.count'),
  fallbacks: fallbackCountsOf(spans),
  checkSpans: spans.length,
})

const versionOf = (value: AttributeScalar): Option.Option<number> =>
  Option.orElse(
    Option.liftPredicate(value, Predicate.isNumber),
    () => Option.flatMap(Option.liftPredicate(value, Predicate.isString), finiteOf),
  )

export const countsSchemaVersionsOf = (spans: ReadonlyArray<SpanRecord>): ReadonlyArray<number> =>
  Arr.getSomes(
    spans.map((span) => Option.flatMap(HashMap.get(span.attributes, COUNTS_SCHEMA_VERSION_ATTRIBUTE), versionOf)),
  )
