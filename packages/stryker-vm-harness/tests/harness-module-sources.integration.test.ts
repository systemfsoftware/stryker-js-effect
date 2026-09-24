import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Sandbox } from '@systemfsoftware/stryker-vm-harness'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const FIRST_PARTY_PACKAGES = [
  'vitest',
  '@effect/vitest',
  '@systemfsoftware/effect-gherkin-spec',
] as const

const moduleForPackage = (packageName: string): string | undefined => {
  const address = Sandbox.harnessUrlForSpecifier(packageName)
  return address === undefined ? undefined : Sandbox.harnessSourceFor(address)
}

Feature('Resolving the harness modules a sandboxed test file loads')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A test file importing a first-party runner package is pointed at its harness module',
      Gherkin.Do.pipe(
        Given('the runner packages a sandboxed test file may import, plus one the harness does not serve')(
          'packages',
          () => Effect.succeed({ served: FIRST_PARTY_PACKAGES, unserved: 'unknown-module' }),
        ),
        When('the sandbox resolves each package to the module address it will load')(
          'addresses',
          (s) =>
            Effect.succeed({
              vitest: Sandbox.harnessUrlForSpecifier(s.packages.served[0]),
              effectVitest: Sandbox.harnessUrlForSpecifier(s.packages.served[1]),
              gherkin: Sandbox.harnessUrlForSpecifier(s.packages.served[2]),
              unserved: Sandbox.harnessUrlForSpecifier(s.packages.unserved),
            }),
        ),
        Then('the served packages map to their own harness addresses and the unserved one maps to nothing')((s) => {
          expect(s.addresses.vitest).toBe('vmrunner-harness:vitest')
          expect(s.addresses.effectVitest).toBe('vmrunner-harness:@effect/vitest')
          expect(s.addresses.gherkin).toBe('vmrunner-harness:@systemfsoftware/effect-gherkin-spec')
          expect(s.addresses.unserved).toBeUndefined()
        }),
      ),
    )

    scenario(
      'Each harness module exposes the registration surface its runner package expects',
      Gherkin.Do.pipe(
        Given('a sandbox about to load the harness modules its first-party runner packages resolve to')(
          'packages',
          () => Effect.succeed(FIRST_PARTY_PACKAGES),
        ),
        When('the sandbox looks up the module served for each package')(
          'sources',
          (s) =>
            Effect.succeed({
              vitest: moduleForPackage(s.packages[0]),
              effectVitest: moduleForPackage(s.packages[1]),
              gherkin: moduleForPackage(s.packages[2]),
              unknown: Sandbox.harnessSourceFor('unknown-url'),
            }),
        ),
        Then('each module carries its registration surface and an unknown address serves nothing')((s) => {
          expect(s.sources.vitest).toBeDefined()
          expect(s.sources.vitest).toContain('@systemfsoftware/stryker-js/vm-runner')
          expect(s.sources.vitest).toContain('export { describe, suite, it, test }')
          expect(s.sources.vitest).toContain('export const expect = state.expect')

          expect(s.sources.effectVitest).toBeDefined()
          expect(s.sources.effectVitest).toContain('export const it = state.effectVitest.it')

          expect(s.sources.gherkin).toBeDefined()
          expect(s.sources.gherkin).toContain("export * from '@systemfsoftware/effect-gherkin-spec'")

          expect(s.sources.unknown).toBeUndefined()
        }),
      ),
    )
  })
