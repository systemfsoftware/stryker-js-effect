import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const env = process.env

const unscopedPackageName = () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
  const name = typeof manifest?.name === 'string' ? manifest.name : 'vitest'
  return name.replace(/^@[^/]+\//u, '')
}

const endpoint = (env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://127.0.0.1:4318').replace(/\/+$/u, '')

export const tracesUrl = endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`

export const serviceName = env['OTEL_SERVICE_NAME'] ?? unscopedPackageName()
