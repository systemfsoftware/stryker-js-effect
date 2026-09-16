import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ID_KEYS = new Set(['traceId', 'spanId', 'parentSpanId'])

const inDir = resolve(process.env['IN_DIR'] ?? 'e2e-telemetry')
const otlpUrl = (process.env['OTLP_URL'] ?? 'http://127.0.0.1:4318').replace(/\/+$/u, '')

const hexIds = (node) => {
  if (Array.isArray(node)) {
    return node.map(hexIds)
  }
  if (node !== null && typeof node === 'object') {
    const out = {}
    for (const [key, value] of Object.entries(node)) {
      if (ID_KEYS.has(key) && typeof value === 'string' && value.length > 0) {
        out[key] = Buffer.from(value, 'base64').toString('hex')
      } else {
        out[key] = hexIds(value)
      }
    }
    return out
  }
  return node
}

const main = async () => {
  const fileNames = (await readdir(join(inDir, 'traces'))).filter((name) => name.endsWith('.json'))
  for (const fileName of fileNames) {
    const document = JSON.parse(await readFile(join(inDir, 'traces', fileName), 'utf8'))
    const payload = { resourceSpans: hexIds(document.batches ?? []) }
    const response = await fetch(`${otlpUrl}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      process.stderr.write(`import-traces: ${fileName} rejected with ${response.status}\n`)
      process.exit(1)
    }
  }
  process.stdout.write(`imported ${fileNames.length} traces\n`)
}

await main()
