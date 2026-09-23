#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-env --allow-net --allow-read --allow-import

import { decodeBase64 } from '@std/encoding/base64'
import { encodeHex } from '@std/encoding/hex'
import { join, resolve } from '@std/path'

const ID_BYTE_LENGTH: Record<string, number> = { traceId: 16, spanId: 8, parentSpanId: 8 }
const HEX_DIGITS = /^[0-9a-f]+$/iu

type TempoTrace = {
  batches?: ReadonlyArray<unknown>
}

const inDir = resolve(Deno.env.get('IN_DIR') ?? 'e2e-telemetry')
const otlpUrl = (Deno.env.get('OTLP_URL') ?? 'http://127.0.0.1:4318').replace(/\/+$/u, '')

const toHexId = (key: string, value: string): string => {
  const byteLength = ID_BYTE_LENGTH[key]
  if (byteLength === undefined || value.length === 0) return value
  if (value.length === byteLength * 2 && HEX_DIGITS.test(value)) return value
  return encodeHex(decodeBase64(value))
}

const asHexIds = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(asHexIds)
  if (node === null || typeof node !== 'object') return node
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      typeof value === 'string' ? toHexId(key, value) : asHexIds(value),
    ]),
  )
}

const traceFileNames = (await Array.fromAsync(Deno.readDir(join(inDir, 'traces'))))
  .map((entry) => entry.name)
  .filter((name) => name.endsWith('.json'))

const sendTrace = async (fileName: string): Promise<void> => {
  const document = JSON.parse(await Deno.readTextFile(join(inDir, 'traces', fileName))) as TempoTrace
  const response = await fetch(`${otlpUrl}/v1/traces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceSpans: asHexIds(document.batches ?? []) }),
  })
  if (!response.ok) {
    console.error(`::error::import-traces: ${fileName} rejected with ${response.status}`)
    Deno.exit(1)
  }
}

await Promise.all(traceFileNames.map(sendTrace))

console.log(`imported ${traceFileNames.length} traces`)
