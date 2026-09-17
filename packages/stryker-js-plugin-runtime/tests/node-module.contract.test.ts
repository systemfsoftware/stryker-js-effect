import { Module } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { describe, expect, it } from 'vitest'

import { nodeModuleLayer } from '../src/node-module.js'

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

describe('nodeModuleLayer', () => {
  const real = findWith(nodeModuleLayer)

  it('resolves every fixture specifier to its package manifest', () => {
    for (const fixture of FIXTURES) {
      expect(real(fixture.specifier)).toBe(fixture.expected)
    }
  })

  it('agrees pairwise with the fixed-path substitute', () => {
    const substitute = findWith(fixedPathModuleLayer)
    for (const fixture of FIXTURES) {
      expect(real(fixture.specifier)).toBe(substitute(fixture.specifier))
    }
  })

  it('answers undefined for a specifier that resolves to no package, never throwing', () => {
    expect(() => real('this-package-does-not-exist')).not.toThrow()
    expect(real('this-package-does-not-exist')).toBe(undefined)
  })
})
