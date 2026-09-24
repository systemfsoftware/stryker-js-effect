import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

import {
  outcomeOf,
  sandboxProject,
  suiteFileLayer,
  symlinkedEnvironmentSandboxOf,
} from './__fixtures__/environment-sandbox.js'

const Feature = makeFeature({ it, layer })

const provideSuite = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E> => Effect.provide(effect, suiteFileLayer)

const linkedFile = {
  name: 'linked.test.ts',
  source: [
    "import { expect, test } from 'vitest'",
    '',
    "test('a test file reached through the link loads and runs', () => {",
    "  expect('linked directory').toBe('linked directory')",
    '})',
    '',
    "test('a second test in the same file runs too', () => {",
    '  expect(2 + 2).toBe(4)',
    '})',
  ].join('\n'),
}

Feature('Running a test suite from a project directory reached through a link')
  .withLayer(suiteFileLayer)
  .body(({ scenario }) => {
    scenario(
      'A file in a project reached through a linked directory loads and passes',
      Gherkin.Do.pipe(
        Given('a project whose directory is reached through a link to another directory')(
          'sandbox',
          () => provideSuite(symlinkedEnvironmentSandboxOf([linkedFile], () => sandboxProject({}))),
        ),
        When('the file runs')('outcome', (s) => Effect.map(s.sandbox.runSuite, outcomeOf)),
        Then('the file passes with both of its tests collected')((s) => {
          expect(s.outcome.status).toBe('complete')
          expect(s.outcome.results).toEqual([
            {
              name: 'a test file reached through the link loads and runs',
              status: 'success',
              failureMessage: undefined,
            },
            {
              name: 'a second test in the same file runs too',
              status: 'success',
              failureMessage: undefined,
            },
          ])
        }),
      ),
    )
  })
