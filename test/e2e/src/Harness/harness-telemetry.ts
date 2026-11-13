import { Effect } from 'effect'

export const COMPONENT_ATTRIBUTE = 'e2e.component'

export const SpanNames = {
  setup: 'e2e.setup',
  prune: 'e2e.setup.prune',
  packageBuild: 'e2e.setup.package.build',
  fixtureKeys: 'e2e.setup.key.fixtures',
  fixtureKey: 'e2e.setup.key.fixtures.fixture',
  bake: 'e2e.setup.bake',
  install: 'e2e.fixture.install',
  guestJob: 'e2e.guest.job',
  cliRun: 'e2e.cli.run',
} as const

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
