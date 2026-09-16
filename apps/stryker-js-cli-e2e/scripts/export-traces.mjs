import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const SEARCH_WINDOW_MAX_SECONDS = 604_800

const tempoUrl = (process.env['TEMPO_URL'] ?? 'http://127.0.0.1:3200').replace(/\/+$/u, '')
const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'stryker-js-cli-e2e'
const windowEnd = Number(process.env['TRACE_WINDOW_END'] ?? Math.floor(Date.now() / 1000))
const windowStart = Number(process.env['TRACE_WINDOW_START'] ?? windowEnd - SEARCH_WINDOW_MAX_SECONDS)
const outDir = resolve(process.env['OUT_DIR'] ?? 'e2e-telemetry')
const gated = process.env['OTEL_ENABLED'] === 'true'

const fail = (message) => {
  process.stderr.write(`export-traces: ${message}\n`)
  process.exit(1)
}

const searchUrl = `${tempoUrl}/api/search?tags=service.name%3D${
  encodeURIComponent(serviceName)
}&start=${windowStart}&end=${windowEnd}&limit=1000`

const searchTraces = async () => {
  const response = await fetch(searchUrl)
  if (!response.ok) {
    throw new Error(
      `Tempo search returned ${response.status} for window ${
        windowEnd - windowStart
      }s; the window must be at most ${SEARCH_WINDOW_MAX_SECONDS}s and supply both start and end`,
    )
  }
  const document = await response.json()
  return document.traces ?? []
}

const exportTrace = async (traceId) => {
  const response = await fetch(`${tempoUrl}/api/traces/${traceId}`)
  if (!response.ok) {
    throw new Error(`Tempo trace ${traceId} returned ${response.status}`)
  }
  const document = await response.json()
  await writeFile(join(outDir, 'traces', `${traceId}.json`), JSON.stringify(document, null, 2))
}

const manifest = async (traceCount) => {
  const document = {
    service: serviceName,
    windowStart,
    windowEnd,
    traceCount,
    exportedAt: new Date().toISOString(),
  }
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(document, null, 2))
}

const main = async () => {
  await mkdir(join(outDir, 'traces'), { recursive: true })
  let traces
  try {
    traces = await searchTraces()
  } catch (cause) {
    if (gated) {
      fail(cause.message)
    }
    await manifest(0)
    process.stdout.write(`export-traces: ${cause.message}; wrote empty manifest\n`)
    return
  }
  for (const trace of traces) {
    await exportTrace(trace.traceID)
  }
  await manifest(traces.length)
  if (gated && traces.length === 0) {
    fail(`OTEL_ENABLED=true but Tempo returned 0 traces for ${serviceName}`)
  }
  process.stdout.write(`export-traces: ${traces.length} trace(s) for ${serviceName}\n`)
}

await main()
