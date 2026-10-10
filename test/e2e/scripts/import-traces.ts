#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-env --allow-net --allow-read --allow-import

import { join, resolve } from '@std/path'

const capture = join(resolve(Deno.env.get('IN_DIR') ?? 'e2e-telemetry'), 'capture', 'traces.jsonl')
const otlpUrl = (Deno.env.get('OTLP_URL') ?? 'http://127.0.0.1:4318').replace(/\/+$/u, '')

const requests = (await Deno.readTextFile(capture)).split('\n').filter((line) => line.length > 0)

for (const [index, body] of requests.entries()) {
  const response = await fetch(`${otlpUrl}/v1/traces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (!response.ok) {
    console.error(`::error::import-traces: line ${index + 1} of ${capture} rejected with ${response.status}`)
    Deno.exit(1)
  }
}

console.log(`imported ${requests.length} OTLP requests from ${capture}`)
