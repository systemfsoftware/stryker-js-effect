import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { ThisExpression } from '@systemfsoftware/stryker-ignorer-interface'
import { createAll, loadPlugins, PluginLoadFailedError } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import { Module } from '@systemfsoftware/stryker-js-language'
import type { ModuleRequire } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

interface NodeModuleShape {
  createRequire(filename: string | URL): NodeRequire
  isBuiltin(moduleName: string): boolean
}

const EMPTY_PATHS: readonly string[] = []

const INSTALLED_FIXTURES: Readonly<Record<string, string>> = {
  'plain-ignorer-only': 'plain-ignorer-only.fixture.mjs',
  'plain-ignorer-shadowed': 'plain-ignorer-shadowed.fixture.mjs',
  'both-protocols': 'both-protocols.fixture.mjs',
  'invalid-plain-entry': 'invalid-plain-entry.fixture.mjs',
}

const fixturePath = (name: string): string => `${process.cwd()}/tests/__fixtures__/${INSTALLED_FIXTURES[name] ?? name}`

const makeModuleRequire = (nodeModule: NodeModuleShape, filename: string | URL): ModuleRequire => {
  const requireFrom: NodeRequire = nodeModule.createRequire(filename)
  const requireFn: ModuleRequire = (request: string): unknown => requireFrom(fixturePath(request))
  requireFn.resolve = (request, options) =>
    Option.match(Option.fromUndefinedOr(options), {
      onNone: () => requireFrom.resolve(fixturePath(request)),
      onSome: (present) =>
        requireFrom.resolve(fixturePath(request), {
          paths: [...Option.getOrElse(Option.fromNullishOr(present.paths), () => EMPTY_PATHS)],
        }),
    })
  return requireFn
}

const moduleLayer = Layer.effect(
  Module,
  Effect.sync(() => {
    const nodeModule: NodeModuleShape = process.getBuiltinModule('node:module')
    return {
      createRequire: (filename: string | URL) => makeModuleRequire(nodeModule, filename),
      isBuiltin: (moduleName: string) => nodeModule.isBuiltin(moduleName),
    }
  }),
)

const loaderLayer = Layer.mergeAll(Path.layer, moduleLayer)

const loadFixture = (name: string) => loadPlugins([name], process.cwd()).pipe(Effect.provide(loaderLayer))

const refusedLoad = (name: string) =>
  loadFixture(name).pipe(
    Effect.flip,
    Effect.flatMap((error) =>
      Match.value(error).pipe(
        Match.tag('PluginLoadFailedError', (failure) => Effect.succeed(failure)),
        Match.orElse(() => Effect.die(new Error(`${name} was expected to be refused with a load failure`))),
      )
    ),
  )

const anyNode: ThisExpression = { type: 'ThisExpression' }

Feature('Loading the ignorers a project declares')
  .body(({ scenario }) => {
    scenario(
      'A module declaring only ignorers loads each one under its own name',
      Gherkin.Do.pipe(
        Given('a project whose module declares one ignorer that rejects a node and one that never does')(
          'loaded',
          () => loadFixture('plain-ignorer-only'),
        ),
        When('the declared ignorers are read and asked about a node')('seen', (s) =>
          Effect.sync(() => ({
            names: s.loaded.ignorers.map((ignorer) => ignorer.name),
            reasons: s.loaded.ignorers.map((ignorer) => ignorer.shouldIgnore(anyNode, [])),
          }))),
        Then('each one answers under its own name with the reason it gave')((s) => {
          expect(s.seen.names).toStrictEqual(['plain-fixture-rule', 'plain-fixture-never'])
          expect(s.seen.reasons).toStrictEqual(['fixture reason', undefined])
        }),
      ),
    )

    scenario(
      'An ignorer stays the plain decision its module declared, not a plugin of any kind',
      Gherkin.Do.pipe(
        Given('a project whose module declares only ignorers')(
          'loaded',
          () => loadFixture('plain-ignorer-only'),
        ),
        When('what the module contributed is read')('seen', (s) =>
          Effect.sync(() => ({
            kinds: Array.from(HashMap.keys(s.loaded.pluginsByKind)),
            modulePaths: s.loaded.pluginModulePaths,
            names: s.loaded.ignorers.map((ignorer) => ignorer.name),
          }))),
        Then('the ignorers stand alone and the module is not handed to a worker')((s) => {
          expect(s.seen.kinds).toStrictEqual([])
          expect(s.seen.modulePaths).toStrictEqual([])
          expect(s.seen.names).toStrictEqual(['plain-fixture-rule', 'plain-fixture-never'])
        }),
      ),
    )

    scenario(
      'A module declaring both a plugin and an ignorer keeps the two apart',
      Gherkin.Do.pipe(
        Given('a project whose module declares one reporter and one ignorer')(
          'loaded',
          () => loadFixture('both-protocols'),
        ),
        When('what the module contributed is read')('seen', (s) =>
          Effect.sync(() => ({
            reporters: createAll(s.loaded.pluginsByKind, 'Reporter').pipe(Effect.runSync).map((plugin) => plugin.name),
            ignorers: s.loaded.ignorers.map((ignorer) => ignorer.name),
            modulePaths: s.loaded.pluginModulePaths,
          }))),
        Then('the reporter is still offered and the ignorer stays a plain decision')((s) => {
          expect(s.seen.reporters).toStrictEqual(['native-fixture-reporter'])
          expect(s.seen.ignorers).toStrictEqual(['plain-fixture-rule'])
          expect(s.seen.modulePaths).toStrictEqual([fixturePath('both-protocols')])
        }),
      ),
    )

    scenario(
      'An ignorer missing its name or its decision is refused, and the refusal names the module',
      Gherkin.Do.pipe(
        Given('a project whose module declares an ignorer with no name and no decision')(
          'module',
          () => Effect.succeed('invalid-plain-entry'),
        ),
        When('the project loads that module')('failure', (s) => refusedLoad(s.module)),
        Then('the load is refused, naming the module')((s) => {
          expect(s.failure).toBeInstanceOf(PluginLoadFailedError)
          expect(s.failure.descriptor).toContain('invalid-plain-entry')
        }),
      ),
    )

    scenario(
      'Two ignorers sharing a name both load under that name',
      Gherkin.Do.pipe(
        Given('a project whose module declares two ignorers sharing a name')(
          'module',
          () => Effect.succeed('plain-ignorer-shadowed'),
        ),
        When('the project loads that module')('names', (s) =>
          loadFixture(s.module).pipe(
            Effect.map((loaded) => loaded.ignorers.map((ignorer) => ignorer.name)),
          )),
        Then('both are loaded under the shared name')((s) => {
          expect(s.names).toStrictEqual(['duplicated-rule', 'duplicated-rule'])
        }),
      ),
    )
  })
