import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { StageError } from '@systemfsoftware/stryker-js-engine'
import { create, createAll, PluginLoadFailedError } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import { expect } from 'vitest'

import {
  fixturePath,
  isExtensionClaimShadowing,
  loadDescriptors,
  reasonTagOf,
  REFUSAL_ROWS,
  refusalFieldsOf,
} from './__fixtures__/loader-support.js'

const Feature = makeFeature({ it, layer })

Feature('Loading framework plugins')
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'A module that contributes a file format loads and reports what it contributes',
      Gherkin.Do.pipe(
        Given('a module declaring one framework format')(
          'descriptor',
          () => Effect.succeed(fixturePath('framework-loaded.fixture.mjs')),
        ),
        When('the loader loads that module')('loaded', (s) => loadDescriptors([s.descriptor])),
        Then('it is reported as loaded together with the contribution it declares')((s) =>
          Effect.sync(() => {
            expect(s.loaded.outcomes).toHaveLength(1)
            const [outcome] = s.loaded.outcomes
            expect(outcome?.outcome).toBe('loaded')
            expect(outcome?.moduleName).toContain('framework-loaded.fixture.mjs')
            expect(outcome?.contributions).toStrictEqual([{ kind: 'Framework', name: 'framework-fixture' }])
          })
        ),
      ),
    )

    scenario(
      'The first module to claim a file extension wins and the losing module keeps its ignorer',
      Gherkin.Do.pipe(
        Given('two modules that both claim the html extension')(
          'descriptors',
          () =>
            Effect.succeed([
              fixturePath('framework-html-alpha.fixture.mjs'),
              fixturePath('framework-html-beta.fixture.mjs'),
            ]),
        ),
        When('the loader loads both modules')('result', (s) =>
          Effect.gen(function*() {
            const loaded = yield* loadDescriptors(s.descriptors)
            const ignorers = yield* createAll(loaded.pluginsByKind, 'Ignore')
            return { loaded, ignorers }
          })),
        Then('the later module is reported as shadowed and both ignorers remain available')((s) =>
          Effect.sync(() => {
            const shadowings = s.result.loaded.shadowings.filter(isExtensionClaimShadowing)
            expect(shadowings.map((shadowing) => [shadowing.extension, shadowing.formatId])).toStrictEqual([
              ['.html', 'html'],
            ])
            expect(shadowings[0]?.winnerModule).toContain('framework-html-alpha.fixture.mjs')
            expect(shadowings[0]?.loserModule).toContain('framework-html-beta.fixture.mjs')
            expect(s.result.ignorers.map((contribution) => contribution.name)).toStrictEqual([
              'alpha-ignorer',
              'beta-ignorer',
            ])
          })
        ),
      ),
    )

    scenarioOutline(
      'A module with <label> is refused before the run starts',
      REFUSAL_ROWS,
      (row) =>
        Gherkin.Do.pipe(
          Given('a plugin module that the loader cannot accept')(
            'descriptor',
            () => Effect.succeed(fixturePath(row.fixture)),
          ),
          When('the loader loads that module')('failure', (s) => loadDescriptors([s.descriptor]).pipe(Effect.flip)),
          Then('the run is refused with the matching exit class, keeping that class through the prepare stage')((s) =>
            Effect.sync(() => {
              expect(s.failure).toBeInstanceOf(PluginLoadFailedError)
              expect(reasonTagOf(s.failure.reason)).toBe(row.reason)
              expect(refusalFieldsOf(s.failure.reason)).toStrictEqual({
                peer: row.peer,
                version: row.version,
                supportedRange: row.supportedRange,
              })
              expect(s.failure.descriptor).toContain(row.fixture)
              expect(s.failure.exitClass).toBe(row.exitClass)
              expect(
                new StageError({ stage: 'prepare', reason: 'Failed to load plugins', cause: s.failure }).exitClass,
              ).toBe(row.exitClass)
              if (row.detail.length > 0) {
                const detail = Match.value(s.failure.reason).pipe(
                  Match.tag('InvalidContribution', (contribution) => contribution.detail),
                  Match.orElse(() => ''),
                )
                expect(detail).toContain(row.detail)
              }
            })
          ),
        ),
    )

    scenario(
      'A named plugin that is not installed is reported as absent',
      Gherkin.Do.pipe(
        Given('a project whose plugin list names a package that is not installed')(
          'descriptors',
          () => Effect.succeed(['@systemfsoftware/absent-plugin-fixture']),
        ),
        When('the loader loads that plugin list and a named selection is made')(
          'result',
          (s) =>
            Effect.gen(function*() {
              const loaded = yield* loadDescriptors(s.descriptors)
              const selection = yield* create(loaded.pluginsByKind, 'Ignore', 'absent-rule').pipe(Effect.flip)
              return { loaded, selection }
            }),
        ),
        Then('it is reported as absent and a run that requires it is refused as a configuration error')((s) =>
          Effect.sync(() => {
            expect(s.result.loaded.outcomes).toHaveLength(1)
            const [outcome] = s.result.loaded.outcomes
            expect(outcome?.moduleName).toBe('@systemfsoftware/absent-plugin-fixture')
            expect(outcome?.outcome).toBe('absent')
            expect(outcome?.contributions).toStrictEqual([])
          })
        ),
      ),
    )
  })
