const SEARCH_LIMIT = 1000

const POLL_INTERVAL_MS = 1_000

const DEFAULT_TIMEOUT_MS = 90_000

export interface TraceSpan {
  readonly serviceName: string
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId: string
  readonly name: string
  readonly attributes: ReadonlyMap<string, string>
  readonly linkedTraceIds: readonly string[]
}

const tempoUrl = (): string => (process.env['TEMPO_URL'] ?? 'http://127.0.0.1:3200').replace(/\/+$/u, '')

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined

const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const numberText = (value: unknown): string | undefined =>
  typeof value === 'number' ? String(value) : typeof value === 'boolean' ? String(value) : undefined

const attributeText = (value: unknown): string | undefined => {
  const document = asRecord(value)
  if (document === undefined) return undefined
  return asString(document['stringValue']) ?? numberText(document['intValue']) ??
    numberText(document['boolValue']) ?? numberText(document['doubleValue'])
}

const attributeMapOf = (attributes: unknown): ReadonlyMap<string, string> =>
  new Map(
    asArray(attributes).flatMap((attribute) => {
      const entry = asRecord(attribute)
      const key = entry === undefined ? undefined : asString(entry['key'])
      const text = entry === undefined ? undefined : attributeText(entry['value'])
      return key === undefined || text === undefined ? [] : [[key, text] as const]
    }),
  )

const serviceNameOf = (resource: unknown): string => {
  const document = asRecord(resource)
  return document === undefined ? '' : attributeMapOf(document['attributes']).get('service.name') ?? ''
}

const linkedTraceIdsOf = (links: unknown): readonly string[] =>
  asArray(links).flatMap((link) => {
    const traceId = asString(asRecord(link)?.['traceId'])
    return traceId === undefined ? [] : [traceId]
  })

const spanOf = (serviceName: string, value: unknown): TraceSpan | undefined => {
  const document = asRecord(value)
  if (document === undefined) return undefined
  const traceId = asString(document['traceId'])
  const spanId = asString(document['spanId'])
  const name = asString(document['name'])
  if (traceId === undefined || spanId === undefined || name === undefined) return undefined
  return {
    serviceName,
    traceId,
    spanId,
    parentSpanId: asString(document['parentSpanId']) ?? '',
    name,
    attributes: attributeMapOf(document['attributes']),
    linkedTraceIds: linkedTraceIdsOf(document['links']),
  }
}

const spansOfTrace = (document: unknown): readonly TraceSpan[] =>
  asArray(asRecord(document)?.['batches']).flatMap((batch) => {
    const entry = asRecord(batch)
    if (entry === undefined) return []
    const serviceName = serviceNameOf(entry['resource'])
    return asArray(entry['scopeSpans']).flatMap((scopeSpan) => {
      const spans = asRecord(scopeSpan)?.['spans']
      return asArray(spans).flatMap((span) => {
        const parsed = spanOf(serviceName, span)
        return parsed === undefined ? [] : [parsed]
      })
    })
  })

const waitFor = (milliseconds: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, milliseconds)
  return promise
}

const searchTraceIds = async (startSeconds: number, endSeconds: number): Promise<readonly string[]> => {
  const url = `${tempoUrl()}/api/search?start=${startSeconds}&end=${endSeconds}&limit=${SEARCH_LIMIT}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Tempo search returned ${response.status} for ${url}`)
  }
  const document: unknown = await response.json()
  return asArray(asRecord(document)?.['traces']).flatMap((trace) => {
    const traceId = asString(asRecord(trace)?.['traceID'])
    return traceId === undefined ? [] : [traceId]
  })
}

const RETRY_ATTEMPTS = 5
const BACKOFF_BASE_MS = 500
const READ_CONCURRENCY = 4

const readTraceWithRetry = async (traceId: string): Promise<readonly TraceSpan[]> => {
  for (let attempt = 1;; attempt += 1) {
    const response = await fetch(`${tempoUrl()}/api/traces/${traceId}`)
    if (response.ok) {
      const document: unknown = await response.json()
      return spansOfTrace(document)
    }
    if (attempt >= RETRY_ATTEMPTS || (response.status !== 429 && response.status < 500)) {
      throw new Error(`Tempo trace ${traceId} returned ${response.status} after ${attempt} attempt(s)`)
    }
    await waitFor(BACKOFF_BASE_MS * attempt)
  }
}

export const readWindowSpans = async (params: {
  readonly startSeconds: number
  readonly serviceName: string
}): Promise<readonly TraceSpan[]> => {
  const traceIds = await searchTraceIds(params.startSeconds, Math.floor(Date.now() / 1000) + 1)
  const queue = [...traceIds]
  const results: TraceSpan[][] = []
  const workers = Array.from(
    { length: Math.min(READ_CONCURRENCY, queue.length) },
    async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const spans = await readTraceWithRetry(next)
        results.push([...spans])
      }
    },
  )
  await Promise.all(workers)
  return results.flat().filter((span) => span.serviceName === params.serviceName)
}

export const pollWindowSpans = async (params: {
  readonly startSeconds: number
  readonly serviceName: string
  readonly isSettled: (spans: readonly TraceSpan[]) => boolean
  readonly timeoutMs?: number
}): Promise<readonly TraceSpan[]> => {
  const deadline = Date.now() + (params.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  for (;;) {
    const outcome = await readWindowSpans(params).then(
      (spans) => ({ spans }) as const,
      (error: unknown) => ({ error }) as const,
    )
    if ('error' in outcome) {
      if (Date.now() >= deadline) throw outcome.error
    } else if (params.isSettled(outcome.spans) || Date.now() >= deadline) {
      return outcome.spans
    }
    await waitFor(POLL_INTERVAL_MS)
  }
}
