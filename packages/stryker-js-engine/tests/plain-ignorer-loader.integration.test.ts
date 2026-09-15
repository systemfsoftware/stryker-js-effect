import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { ThisExpression } from '@systemfsoftware/stryker-ignorer-interface'
import { create, createAll, PluginLoadFailedError } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import { Ignorer } from '@systemfsoftware/stryker-js-language'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import { expect } from 'vitest'
import { loadFixture, pluginEnvironmentLayer } from './__fixtures__/loader-support.js'

const Feature = makeFeature({ it, layer })

const anyNode: ThisExpression = { type: 'ThisExpression' }

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
            expect(Option.getOrThrow(s.services.rule.shouldIgnore(anyNode, []))).toBe('fixture reason')
            expect(Option.isNone(s.services.never.shouldIgnore(anyNode, []))).toBe(true)
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
          Effect.gen(function*() {
            const reporters = yield* createAll(s.loaded.pluginsByKind, 'Reporter')
            const ignorers = yield* createAll(s.loaded.pluginsByKind, 'Ignore')
            return { reporters: reporters.map((c) => c.name), ignorers: ignorers.map((c) => c.name) }
          })),
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
            Effect.gen(function*() {
              const loaded = yield* loadFixture('plain-ignorer-shadowed.fixture.mjs')
              const ignorers = yield* createAll(loaded.pluginsByKind, 'Ignore')
              return ignorers.map((c) => c.name)
            }),
        ),
        Then('both entries appear under the shared name')((s) =>
          Effect.sync(() => {
            expect(s.names).toStrictEqual(['duplicated-rule', 'duplicated-rule'])
          })
        ),
      ),
    )
  })
