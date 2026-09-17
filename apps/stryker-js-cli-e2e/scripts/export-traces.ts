#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-env --allow-net --allow-read --allow-write --allow-import

import { ensureDir } from '@std/fs/ensure-dir'
import { join, resolve } from '@std/path'

const SEARCH_WINDOW_SECONDS = 604_800

const POLL_INTERVAL_MS = 1_000

type TracesResponse = {
  traces?: ReadonlyArray<{ traceID: string }>
}

const tempoUrl = (Deno.env.get('TEMPO_URL') ?? 'http://127.0.0.1:3200').replace(/\/+$/u, '')
const serviceName = Deno.env.get('OTEL_SERVICE_NAME') ?? 'stryker-js-cli-e2e'
const knownServiceNames = async (): Promise<readonly string[]> => {
  const response = await fetch(`${tempoUrl}/api/search/tag/service.name/values`)
  if (!response.ok) return []
  const document = (await response.json()) as { tagValues?: readonly string[] }
  return document.tagValues ?? []
}
const windowEnd = Number(Deno.env.get('TRACE_WINDOW_END') ?? Math.floor(Date.now() / 1000))
const windowStart = Number(Deno.env.get('TRACE_WINDOW_START') ?? windowEnd - SEARCH_WINDOW_SECONDS)
const outDir = resolve(Deno.env.get('OUT_DIR') ?? 'e2e-telemetry')
const gated = Deno.env.get('OTEL_ENABLED') === 'true'
const waitSeconds = Number(Deno.env.get('TRACE_WAIT_SECONDS') ?? 60)

const fail = (message: string): never => {
  console.error(`::error::export-traces: ${message}`)
  return Deno.exit(1)
}

const searchUrl = `${tempoUrl}/api/search?tags=service.name%3D${
  encodeURIComponent(serviceName)
}&start=${windowStart}&end=${windowEnd}&limit=1000`

const searchTraces = async (): Promise<ReadonlyArray<{ traceID: string }>> => {
  for (let attempt = 1;; attempt += 1) {
    const response = await fetch(searchUrl)
    if (response.ok) {
      const document = (await response.json()) as TracesResponse
      return document.traces ?? []
    }
    if (attempt >= MAX_WRITE_ATTEMPTS || !isRetriableStatus(response.status)) {
      throw new Error(
        `Tempo search returned ${response.status} for a ${
          windowEnd - windowStart
        }s window; the window must be at most ${SEARCH_WINDOW_SECONDS}s and supply both start and end`,
      )
    }
    await waitFor(RATE_LIMIT_BACKOFF_MS * attempt)
  }
}

const WRITE_CONCURRENCY = 4
const RATE_LIMIT_BACKOFF_MS = 2_000
const MAX_WRITE_ATTEMPTS = 5

const isRetriableStatus = (status: number): boolean => status === 429 || status >= 500

const writeTraceWithRetry = async (traceId: string): Promise<void> => {
  for (let attempt = 1;; attempt += 1) {
    const response = await fetch(`${tempoUrl}/api/traces/${traceId}`)
    if (response.ok) {
      const document = await response.json()
      await Deno.writeTextFile(join(outDir, 'traces', `${traceId}.json`), `${JSON.stringify(document, null, 2)}\n`)
      return
    }
    if (attempt >= MAX_WRITE_ATTEMPTS || !isRetriableStatus(response.status)) {
      throw new Error(`Tempo trace ${traceId} returned ${response.status} after ${attempt} attempt(s)`)
    }
    await waitFor(RATE_LIMIT_BACKOFF_MS * attempt)
  }
}

const writeAllTraces = async (traceIds: readonly string[]): Promise<void> => {
  const queue = [...traceIds]
  const workers = Array.from(
    { length: Math.min(WRITE_CONCURRENCY, queue.length) },
    async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        await writeTraceWithRetry(next)
      }
    },
  )
  await Promise.all(workers)
}

const writeManifest = async (traceCount: number): Promise<void> => {
  const manifest = {
    service: serviceName,
    windowStart,
    windowEnd,
    traceCount,
    exportedAt: new Date().toISOString(),
  }
  await Deno.writeTextFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

const waitFor = (milliseconds: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, milliseconds)
  return promise
}

const searchUntilVisible = async (): Promise<ReadonlyArray<{ traceID: string }>> => {
  const deadline = Date.now() + waitSeconds * 1_000
  for (;;) {
    const found = await searchTraces()
    console.log(`export-traces: ${found.length} trace(s) searchable for ${serviceName}`)
    if (found.length > 0 || Date.now() >= deadline) return found
    await waitFor(POLL_INTERVAL_MS)
  }
}

await ensureDir(join(outDir, 'traces'))

const traces = await searchUntilVisible().catch(async (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (gated) fail(message)
  await writeManifest(0)
  console.log(`export-traces: ${message}; wrote an empty manifest`)
  return Deno.exit(0)
})

await writeAllTraces(traces.map((trace) => trace.traceID))
await writeManifest(traces.length)

if (gated && traces.length === 0) {
  const held = await knownServiceNames()
  fail(
    `OTEL_ENABLED=true but Tempo returned 0 traces for ${serviceName} within ${waitSeconds}s; Tempo holds [${
      held.join(', ')
    }]`,
  )
}
console.log(`export-traces: ${traces.length} trace(s) for ${serviceName}`)
