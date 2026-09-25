import * as TestTelemetry from '@systemfsoftware/vitest-config/telemetry'
import { Effect, type Layer } from 'effect'
import type { OtlpExporter } from 'effect/unstable/observability'

export const COMPONENT_ATTRIBUTE = 'e2e.component'

export const SpanNames = {
  setup: 'e2e.setup',
  prune: 'e2e.setup.prune',
  pack: 'e2e.setup.pack',
  packBuild: 'e2e.setup.pack.build',
  packTarballs: 'e2e.setup.pack.tarballs',
  packsKey: 'e2e.setup.key.packs',
  packsKeyUnpack: 'e2e.setup.key.packs.unpack',
  fixtureKeys: 'e2e.setup.key.fixtures',
  fixtureKey: 'e2e.setup.key.fixtures.fixture',
  bake: 'e2e.setup.bake',
  install: 'e2e.fixture.install',
  guestJob: 'e2e.guest.job',
  cliRun: 'e2e.cli.run',
} as const

export const layer: Layer.Layer<OtlpExporter.Flusher> = TestTelemetry.layer({ [COMPONENT_ATTRIBUTE]: 'harness' })

export const withSeamSpan = <A, E, R>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.withSpan(effect, name, { attributes })

export const seamSpan = (
  name: string,
  attributes: Record<string, string | number | boolean>,
): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> =>
(effect) => Effect.withSpan(effect, name, { attributes })
