import * as S from 'effect/Schema'
import * as http from 'node:http'

export const CHECK_SPAN_NAME = 'typescript-checker.compiler.check'

export const COUNTS_SCHEMA_VERSION_ATTRIBUTE = 'typescript.counts.schema_version'

export const COUNTS_SCHEMA_VERSION = 1

const FALLBACK_PREFIX = 'typescript.importer_shortcut.fallback.'
const FALLBACK_SUFFIX = '.count'

const SERVICE_NAME_ATTRIBUTE = 'service.name'

const AttributeValue = S.Struct({
  stringValue: S.optional(S.String),
  intValue: S.optional(S.Union([S.String, S.Number])),
  doubleValue: S.optional(S.Number),
  boolValue: S.optional(S.Boolean),
})

const KeyValue = S.Struct({ key: S.String, value: AttributeValue })

const Span = S.Struct({
  name: S.String,
  attributes: S.optional(S.Array(KeyValue)),
})

const ScopeSpans = S.Struct({ spans: S.Array(Span) })

const Resource = S.Struct({ attributes: S.optional(S.Array(KeyValue)) })

const ResourceSpans = S.Struct({
  resource: S.optional(Resource),
  scopeSpans: S.optional(S.Array(ScopeSpans)),
})

export const OtlpExportRequest = S.Struct({ resourceSpans: S.Array(ResourceSpans) })
export type OtlpExportRequest = typeof OtlpExportRequest.Type

export const decodeOtlpExport = S.decodeResult(S.fromJsonString(OtlpExportRequest))

export type AttributeValueScalar = string | number | boolean

export interface SpanRecord {
  readonly serviceName: string
  readonly name: string
  readonly attributes: ReadonlyMap<string, AttributeValueScalar>
}

const scalarOf = (value: typeof AttributeValue.Type): AttributeValueScalar | undefined => {
  if (value.stringValue !== undefined) return value.stringValue
  if (value.intValue !== undefined) {
    const asNumber = typeof value.intValue === 'number' ? value.intValue : Number(value.intValue)
    return Number.isFinite(asNumber) ? asNumber : undefined
  }
  if (value.doubleValue !== undefined) return value.doubleValue
  if (value.boolValue !== undefined) return value.boolValue
  return undefined
}

const attributesOf = (pairs: ReadonlyArray<typeof KeyValue.Type>): ReadonlyMap<string, AttributeValueScalar> =>
  new Map(
    pairs.flatMap((pair) => {
      const scalar = scalarOf(pair.value)
      return scalar === undefined ? [] : [[pair.key, scalar] as const]
    }),
  )

const serviceNameOf = (resource: typeof Resource.Type | undefined): string => {
  const serviceName = attributesOf(resource?.attributes ?? []).get(SERVICE_NAME_ATTRIBUTE)
  return typeof serviceName === 'string' ? serviceName : ''
}

export const spanRecordsOf = (request: OtlpExportRequest): ReadonlyArray<SpanRecord> =>
  request.resourceSpans.flatMap((resourceSpans) => {
    const serviceName = serviceNameOf(resourceSpans.resource)
    return (resourceSpans.scopeSpans ?? []).flatMap((scopeSpans) =>
      scopeSpans.spans.map((span) => ({
        serviceName,
        name: span.name,
        attributes: attributesOf(span.attributes ?? []),
      }))
    )
  })

export interface SpanCounts {
  readonly snapshotUpdates: number
  readonly resplices: number
  readonly tceBuilds: number
  readonly tceMs: number
  readonly importerShortcuts: number
  readonly fallbacks: Readonly<Record<string, number>>
  readonly checkSpans: number
}

export const emptySpanCounts: SpanCounts = {
  snapshotUpdates: 0,
  resplices: 0,
  tceBuilds: 0,
  tceMs: 0,
  importerShortcuts: 0,
  fallbacks: {},
  checkSpans: 0,
}

const MUTANTS_IDS_ATTRIBUTE = 'stryker.mutants.ids'

const spanNamesMutant = (span: SpanRecord, mutantIds: ReadonlySet<string>): boolean => {
  const ids = span.attributes.get(MUTANTS_IDS_ATTRIBUTE)
  return typeof ids === 'string' && ids.split(',').some((id) => mutantIds.has(id))
}

export const projectCheckSpans = (
  spans: ReadonlyArray<SpanRecord>,
  serviceName: string,
  mutantIds: ReadonlySet<string>,
): ReadonlyArray<SpanRecord> =>
  spans.filter(
    (span) => span.serviceName === serviceName && span.name === CHECK_SPAN_NAME && spanNamesMutant(span, mutantIds),
  )

const numberAttribute = (span: SpanRecord, key: string): number => {
  const value = span.attributes.get(key)
  return typeof value === 'number' ? value : 0
}

const fallbackCountsOf = (spans: ReadonlyArray<SpanRecord>): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {}
  for (const span of spans) {
    for (const [key, value] of span.attributes) {
      if (!key.startsWith(FALLBACK_PREFIX) || !key.endsWith(FALLBACK_SUFFIX) || typeof value !== 'number') continue
      const clause = key.slice(FALLBACK_PREFIX.length, key.length - FALLBACK_SUFFIX.length)
      counts[clause] = (counts[clause] ?? 0) + value
    }
  }
  return counts
}

const sumAttribute = (spans: ReadonlyArray<SpanRecord>, key: string): number =>
  spans.reduce((total, span) => total + numberAttribute(span, key), 0)

export const countsOfSpans = (spans: ReadonlyArray<SpanRecord>): SpanCounts => ({
  snapshotUpdates: sumAttribute(spans, 'typescript.snapshot_updates.count'),
  resplices: sumAttribute(spans, 'typescript.resplices.count'),
  tceBuilds: sumAttribute(spans, 'typescript.tce_builds.count'),
  tceMs: sumAttribute(spans, 'typescript.tce.ms'),
  importerShortcuts: sumAttribute(spans, 'typescript.importer_shortcut.count'),
  fallbacks: fallbackCountsOf(spans),
  checkSpans: spans.length,
})

export const countsSchemaVersionsOf = (spans: ReadonlyArray<SpanRecord>): ReadonlyArray<number> =>
  spans.flatMap((span) => {
    const value = span.attributes.get(COUNTS_SCHEMA_VERSION_ATTRIBUTE)
    if (typeof value === 'number') return [value]
    if (typeof value === 'string') return [Number(value)]
    return []
  })

export interface OtlpReceiver {
  readonly endpoint: string
  readonly spans: () => ReadonlyArray<SpanRecord>
  readonly decodeFailures: () => number
  readonly close: () => Promise<void>
}

export const startOtlpReceiver = (): Promise<OtlpReceiver> => {
  const collected: SpanRecord[] = []
  let decodeFailures = 0
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const decoded = decodeOtlpExport(Buffer.concat(chunks).toString('utf8'))
      if (decoded._tag === 'Success') collected.push(...spanRecordsOf(decoded.success))
      else decodeFailures += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
    })
  })
  const bound = Promise.withResolvers<OtlpReceiver>()
  server.once('error', (error) => bound.reject(error))
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (address === null || typeof address === 'string') {
      bound.reject(new Error('the OTLP receiver did not bind a TCP port'))
      return
    }
    bound.resolve({
      endpoint: `http://127.0.0.1:${address.port}/v1/traces`,
      spans: () => [...collected],
      decodeFailures: () => decodeFailures,
      close: () => {
        const closed = Promise.withResolvers<void>()
        server.close(() => closed.resolve())
        return closed.promise
      },
    })
  })
  return bound.promise
}
