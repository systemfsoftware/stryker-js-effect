#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-env --allow-net --allow-read --allow-write --allow-import

import { ensureDir } from '@std/fs/ensure-dir'
import { join, resolve } from '@std/path'

const SEARCH_WINDOW_SECONDS = 604_800

type TracesResponse = {
  traces?: ReadonlyArray<{ traceID: string }>
}

const tempoUrl = (Deno.env.get('TEMPO_URL') ?? 'http://127.0.0.1:3200').replace(/\/+$/u, '')
const serviceName = Deno.env.get('OTEL_SERVICE_NAME') ?? 'stryker-js-cli-e2e'
const windowEnd = Number(Deno.env.get('TRACE_WINDOW_END') ?? Math.floor(Date.now() / 1000))
const windowStart = Number(Deno.env.get('TRACE_WINDOW_START') ?? windowEnd - SEARCH_WINDOW_SECONDS)
const outDir = resolve(Deno.env.get('OUT_DIR') ?? 'e2e-telemetry')
const gated = Deno.env.get('OTEL_ENABLED') === 'true'

const fail = (message: string): never => {
  console.error(`::error::export-traces: ${message}`)
  return Deno.exit(1)
}

const searchUrl = `${tempoUrl}/api/search?tags=service.name%3D${
  encodeURIComponent(serviceName)
}&start=${windowStart}&end=${windowEnd}&limit=1000`

const searchTraces = async (): Promise<ReadonlyArray<{ traceID: string }>> => {
  const response = await fetch(searchUrl)
  if (!response.ok) {
    throw new Error(
      `Tempo search returned ${response.status} for a ${
        windowEnd - windowStart
      }s window; the window must be at most ${SEARCH_WINDOW_SECONDS}s and supply both start and end`,
    )
  }
  const document = (await response.json()) as TracesResponse
  return document.traces ?? []
}

const writeTrace = async (traceId: string): Promise<void> => {
  const response = await fetch(`${tempoUrl}/api/traces/${traceId}`)
  if (!response.ok) throw new Error(`Tempo trace ${traceId} returned ${response.status}`)
  const document = await response.json()
  await Deno.writeTextFile(join(outDir, 'traces', `${traceId}.json`), `${JSON.stringify(document, null, 2)}\n`)
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

await ensureDir(join(outDir, 'traces'))

const traces = await searchTraces().catch(async (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (gated) fail(message)
  await writeManifest(0)
  console.log(`export-traces: ${message}; wrote an empty manifest`)
  return Deno.exit(0)
})

await Promise.all(traces.map((trace) => writeTrace(trace.traceID)))
await writeManifest(traces.length)

if (gated && traces.length === 0) fail(`OTEL_ENABLED=true but Tempo returned 0 traces for ${serviceName}`)
console.log(`export-traces: ${traces.length} trace(s) for ${serviceName}`)
