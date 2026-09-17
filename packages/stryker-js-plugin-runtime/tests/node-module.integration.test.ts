import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Module } from '@systemfsoftware/stryker-js-language'
import { nodeModuleLayer } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const pathService = Effect.runSync(
  Effect.provide(
    Effect.gen(function*() {
      return yield* Path.Path
    }),
    Path.layer,
  ),
)

const PACKAGE_DIR = Effect.runSync(pathService.fromFileUrl(new URL('..', import.meta.url)))
const NODE_MODULES_DIR = pathService.join(PACKAGE_DIR, 'node_modules')
const BASE = pathService.join(PACKAGE_DIR, 'package.json')

const manifestOf = (packageName: string): string => pathService.join(NODE_MODULES_DIR, packageName, 'package.json')

const FIXED_PATHS: Readonly<Record<string, string | undefined>> = {
  'effect': manifestOf('effect'),
  '@effect/platform-node': manifestOf('@effect/platform-node'),
  'effect/package.json': manifestOf('effect'),
  'this-package-does-not-exist': undefined,
}

const fixedPathModuleLayer: Layer.Layer<Module> = Layer.succeed(Module, {
  findPackageJSON: (specifier: string) => FIXED_PATHS[specifier],
})

interface Fixture {
  readonly specifier: string
  readonly expected: string | undefined
}

const FIXTURES: readonly Fixture[] = [
  { specifier: 'effect', expected: manifestOf('effect') },
  { specifier: '@effect/platform-node', expected: manifestOf('@effect/platform-node') },
  { specifier: 'effect/package.json', expected: manifestOf('effect') },
  { specifier: 'this-package-does-not-exist', expected: undefined },
]

const findWith = (layer: Layer.Layer<Module>) =>
  Effect.runSync(
    Effect.gen(function*() {
      const module = yield* Module
      return (specifier: string): string | undefined => module.findPackageJSON(specifier, BASE)
    }).pipe(Effect.provide(layer)),
  )

Feature('Locating the package a module name refers to').body(({ scenario }) => {
  scenario(
    'An installed package is found by the name that refers to it',
    Gherkin.Do.pipe(
      Given('the package lookup the runtime exposes')('lookup', () => Effect.sync(() => findWith(nodeModuleLayer))),
      When('each installed package is looked up by the name a plugin would use')(
        'looked',
        (s) => Effect.sync(() => FIXTURES.map((fixture) => ({ fixture, found: s.lookup(fixture.specifier) }))),
      ),
      Then('every name names the manifest of the package it belongs to')((s) => {
        for (const looked of s.looked) {
          expect(looked.found).toBe(looked.fixture.expected)
        }
      }),
    ),
  )

  scenario(
    'The lookup names what a fixed table of package paths names',
    Gherkin.Do.pipe(
      Given('the runtime lookup beside a fixed table of package paths')(
        'lookups',
        () => Effect.sync(() => ({ real: findWith(nodeModuleLayer), fixed: findWith(fixedPathModuleLayer) })),
      ),
      When('both are asked about the same package names')(
        'answers',
        (s) =>
          Effect.sync(() =>
            FIXTURES.map((fixture) => ({
              fixture,
              real: s.lookups.real(fixture.specifier),
              fixed: s.lookups.fixed(fixture.specifier),
            }))
          ),
      ),
      Then('both answer with the same manifest for every name')((s) => {
        for (const answer of s.answers) {
          expect(answer.real).toBe(answer.fixed)
        }
      }),
    ),
  )

  scenario(
    'A name that refers to no installed package is answered with nothing',
    Gherkin.Do.pipe(
      Given('the package lookup the runtime exposes')('lookup', () => Effect.sync(() => findWith(nodeModuleLayer))),
      When('a name that refers to no installed package is looked up')('answer', (s) =>
        Effect.sync(() => {
          try {
            return { failure: undefined, found: s.lookup('this-package-does-not-exist') }
          } catch (thrown) {
            return { failure: thrown, found: undefined }
          }
        })),
      Then('the lookup answers nothing and reports no failure')((s) => {
        expect(s.answer.failure).toBe(undefined)
        expect(s.answer.found).toBe(undefined)
      }),
    ),
  )
})
