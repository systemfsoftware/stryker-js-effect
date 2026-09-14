import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createDefaultOptions } from '@systemfsoftware/stryker-js-engine'
import { create, createAll, loadPlugins, PluginLoadFailedError } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import { Ignorer, Module, type NodePath } from '@systemfsoftware/stryker-js-language'
import type { ModuleRequire } from '@systemfsoftware/stryker-js-language'
import { RunConfiguration, SandboxDirectory } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

interface NodeModuleShape {
  createRequire(filename: string | URL): NodeRequire
  isBuiltin(moduleName: string): boolean
}

const EMPTY_PATHS: readonly string[] = []

const makeModuleRequire = (nodeModule: NodeModuleShape, filename: string | URL): ModuleRequire => {
  const requireFrom: NodeRequire = nodeModule.createRequire(filename)
  const requireFn: ModuleRequire = (request: string): unknown => requireFrom(request)
  requireFn.resolve = (request, options) =>
    Option.match(Option.fromUndefinedOr(options), {
      onNone: () => requireFrom.resolve(request),
      onSome: (present) =>
        requireFrom.resolve(request, {
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

const pluginEnvironmentLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  moduleLayer,
  Layer.succeed(RunConfiguration, Effect.runSync(createDefaultOptions())),
  Layer.succeed(SandboxDirectory, '/tmp'),
)

const fixturePath = (name: string): string => `${process.cwd()}/tests/__fixtures__/${name}`

const loadFixture = (name: string) =>
  loadPlugins([fixturePath(name)], process.cwd()).pipe(
    Effect.provide(Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, moduleLayer)),
  )

const pathOf = (node: unknown): NodePath => ({
  node,
  parentPath: null,
  isObjectExpression: () => false,
  isCallExpression: () => false,
  isClassProperty: () => false,
  isClassPrivateProperty: () => false,
  isClassAccessorProperty: () => false,
})

Feature('Loading plain ignorer plugins')
  .body(({ scenario }) => {
    scenario(
      'A module exporting only plain ignorers loads every entry as an ignore contribution',
      Gherkin.Do.pipe(
        Given('a module exporting one plain ignorer and nothing else')(
          'loaded',
          () => loadFixture('plain-ignorer-only.fixture.mjs'),
        ),
        When('each entry is selected by kind and name and its layer is built')(
          'services',
          (s) =>
            Effect.gen(function*() {
              const rule = yield* create(s.loaded.pluginsByKind, 'Ignore', 'plain-fixture-rule')
              const never = yield* create(s.loaded.pluginsByKind, 'Ignore', 'plain-fixture-never')
              const ruleContext = yield* Layer.build(rule.layer).pipe(Effect.provide(pluginEnvironmentLayer))
              const neverContext = yield* Layer.build(never.layer).pipe(Effect.provide(pluginEnvironmentLayer))
              return {
                rule: Context.get(ruleContext, Ignorer),
                never: Context.get(neverContext, Ignorer),
              }
            }),
        ),
        Then('every entry registers under its name and its decisions flow through')((s) =>
          Effect.sync(() => {
            expect(Option.getOrThrow(s.services.rule.shouldIgnore(pathOf('any-node')))).toBe('fixture reason')
            expect(Option.isNone(s.services.never.shouldIgnore(pathOf('any-node')))).toBe(true)
          })
        ),
      ),
    )

    scenario(
      'A module exporting both protocols keeps both kinds',
      Gherkin.Do.pipe(
        Given('a module exporting a native reporter and a plain ignorer')(
          'loaded',
          () => loadFixture('both-protocols.fixture.mjs'),
        ),
        When('the loaded contributions are read back by kind')('names', (s) =>
          Effect.sync(() => ({
            reporters: createAll(s.loaded.pluginsByKind, 'Reporter').pipe(Effect.runSync).map((c) => c.name),
            ignorers: createAll(s.loaded.pluginsByKind, 'Ignore').pipe(Effect.runSync).map((c) => c.name),
          }))),
        Then('both kinds are present')((s) =>
          Effect.sync(() => {
            expect(s.names.reporters).toStrictEqual(['native-fixture-reporter'])
            expect(s.names.ignorers).toStrictEqual(['plain-fixture-rule'])
          })
        ),
      ),
    )

    scenario(
      'A malformed plain entry fails the load with a named error',
      Gherkin.Do.pipe(
        Given('a module whose plain entry has no name and no callable decision')(
          'outcome',
          () => loadFixture('invalid-plain-entry.fixture.mjs').pipe(Effect.flip),
        ),
        Then('the load is rejected naming the module')((s) =>
          Effect.sync(() => {
            expect(s.outcome).toBeInstanceOf(PluginLoadFailedError)
            expect(s.outcome.descriptor).toContain('invalid-plain-entry.fixture.mjs')
          })
        ),
      ),
    )

    scenario(
      'Two plain entries sharing a name both load under that name',
      Gherkin.Do.pipe(
        Given('a module exporting two plain entries with the same name')(
          'names',
          () =>
            loadFixture('plain-ignorer-shadowed.fixture.mjs').pipe(
              Effect.map((loaded) => createAll(loaded.pluginsByKind, 'Ignore').pipe(Effect.runSync).map((c) => c.name)),
            ),
        ),
        Then('both entries appear under the shared name')((s) =>
          Effect.sync(() => {
            expect(s.names).toStrictEqual(['duplicated-rule', 'duplicated-rule'])
          })
        ),
      ),
    )

    scenario(
      'A plain entry whose declared schema is malformed fails the load with a named error',
      Gherkin.Do.pipe(
        Given('a module whose plain entry declares a schema with the wrong version and a non-callable validator')(
          'outcome',
          () => loadFixture('invalid-plain-schema.fixture.mjs').pipe(Effect.flip),
        ),
        Then('the load is rejected naming the module')((s) =>
          Effect.sync(() => {
            expect(s.outcome).toBeInstanceOf(PluginLoadFailedError)
            expect(s.outcome.descriptor).toContain('invalid-plain-schema.fixture.mjs')
          })
        ),
      ),
    )
  })
