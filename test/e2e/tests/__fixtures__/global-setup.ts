import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect'

import { Readiness } from '@systemfsoftware/effect-readiness'

import { BakedFixtureCache } from '../../src/Harness/fixture-cache.service.js'
import { HarnessPlatformLive } from '../../src/Harness/harness-layers.js'
import { tempoBaseUrl } from './tempo-endpoint.js'

const TEMPO_PROBE_PATH = '/ready'
const TEMPO_PROBE_TIMEOUT_MS = 10_000
const TEMPO_PROBE_POLL_MS = 250
const LGTM_REMEDIATION = 'pnpm lgtm:up'

const LogSourceStub = Layer.succeed(Readiness.LogSource, { entries: Effect.succeed([]) })

const SetupLive = Layer.merge(HarnessPlatformLive, LogSourceStub)

const tempoEndpointOf = (baseUrl: string): { readonly host: string; readonly port: number } => {
  const parsed = new URL(baseUrl)
  const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number.parseInt(parsed.port, 10)
  return { host: parsed.hostname, port }
}

const probeTempo = Effect.gen(function*() {
  const baseUrl = yield* tempoBaseUrl
  const { host, port } = tempoEndpointOf(baseUrl)
  const target = Readiness.target([{ guest: port, host, hostPort: port }], {
    timeoutMs: TEMPO_PROBE_TIMEOUT_MS,
    pollMs: TEMPO_PROBE_POLL_MS,
  })
  const verdict = yield* target.awaitCondition(Readiness.Wait.forHttp(TEMPO_PROBE_PATH, port))
  if (verdict._tag === 'TimedOut') {
    return yield* Effect.die(
      new Error(
        `the e2e lane requires the Grafana LGTM collector, but Tempo was unreachable at ${baseUrl} after ${TEMPO_PROBE_TIMEOUT_MS}ms. Start it with \`${LGTM_REMEDIATION}\`.`,
      ),
    )
  }
  return baseUrl
}).pipe(Effect.orDie)

const requireOtelEnabled = (): void => {
  const requested = process.env['OTEL_ENABLED']
  if (requested === 'false') {
    throw new Error(
      `the e2e lane runs every SDK under one OTEL_ENABLED value and refuses an explicit false. Run with \`${LGTM_REMEDIATION}\` and OTEL_ENABLED=true.`,
    )
  }
  process.env['OTEL_ENABLED'] = requested ?? 'true'
}

export default async function setup(): Promise<() => Promise<void>> {
  requireOtelEnabled()
  const runtime = ManagedRuntime.make(SetupLive)
  const probe = await runtime.runPromiseExit(probeTempo)
  if (Exit.isFailure(probe)) {
    await runtime.dispose()
    throw new Error(Cause.pretty(probe.cause))
  }
  const outcome = await runtime.runPromiseExit(BakedFixtureCache.bakeProgram)
  if (Exit.isFailure(outcome)) {
    await runtime.dispose()
    throw new Error(Cause.pretty(outcome.cause))
  }
  process.env[BakedFixtureCache.BAKED_ROOT_ENV] = outcome.value.root
  process.env[BakedFixtureCache.BAKED_KEYS_ENV] = JSON.stringify(outcome.value.keys)
  return async () => {
    await runtime.runPromiseExit(BakedFixtureCache.teardownProgram(outcome.value))
    await runtime.dispose()
  }
}
