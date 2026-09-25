import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import { outcomeOf, suiteFileLayer } from './__fixtures__/environment-sandbox.js'
import { outOfRootSandboxOf } from './__fixtures__/out-of-root-sandbox.js'

const Feature = makeFeature({ it })

const provideSuite = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E> => Effect.provide(effect, suiteFileLayer)

const GUARD_SOURCE = [
  "import { beforeEach } from 'vitest'",
  '',
  'let hookRuns = 0',
  '',
  'beforeEach(() => {',
  '  hookRuns += 1',
  "  globalThis['outOfRootHookRuns'] = hookRuns",
  '})',
].join('\n')

const GUARDED_CONSUMER_SOURCE = [
  "import { expect, test } from 'vitest'",
  '',
  "test('the out-of-root setup hook ran before the first test', () => {",
  "  expect(globalThis['outOfRootHookRuns']).toBe(1)",
  '})',
  '',
  "test('the out-of-root setup hook ran before the second test too', () => {",
  "  expect(globalThis['outOfRootHookRuns']).toBe(2)",
  '})',
].join('\n')

const HELPER_SOURCE = [
  "import { expect, it } from 'vitest'",
  '',
  "it('the out-of-root helper declared this test', () => {",
  '  expect(1 + 1).toBe(2)',
  '})',
].join('\n')

const HELPER_CONSUMER_SOURCE = [
  "import { expect, test } from 'vitest'",
  "import '../shared/helper.ts'",
  '',
  "test('the importing file still runs its own test', () => {",
  '  expect(2 + 2).toBe(4)',
  '})',
].join('\n')

const LINKED_PACKAGE_SOURCE = [
  "import { expect, it } from 'vitest'",
  '',
  "it('the linked workspace package declared this test', () => {",
  "  expect('linked').toBe('linked')",
  '})',
].join('\n')

const LINKED_CONSUMER_SOURCE = [
  "import { expect, test } from 'vitest'",
  "import 'out-of-root-pkg'",
  '',
  "test('the importing file still runs its own test', () => {",
  '  expect(3 + 3).toBe(6)',
  '})',
].join('\n')

Feature('Running a test suite whose modules live outside the project root')
  .withLayer(suiteFileLayer)
  .live('the runner the sandbox serves reaches every module the suite loads')
  .body(({ scenario }) => {
    scenario(
      'A setup file outside the root registers a hook that runs before every test',
      Gherkin.Do.pipe(
        Given('a project whose setup file lives in a sibling directory outside the root')(
          'sandbox',
          () =>
            provideSuite(
              outOfRootSandboxOf({
                projectFiles: [{ name: 'guarded.test.ts', source: GUARDED_CONSUMER_SOURCE }],
                sharedFiles: [{ name: 'guard.ts', source: GUARD_SOURCE }],
                setupFiles: ['guard.ts'],
              }),
            ),
        ),
        When('the file runs')('outcome', (s) => Effect.map(s.sandbox.runSuite, outcomeOf)),
        Then('the dry run completes and the out-of-root hook ran before each test')((s, expect) =>
          expect({ status: s.outcome.status, results: s.outcome.results }).toEqual({
            status: 'complete',
            results: [
              {
                name: 'the out-of-root setup hook ran before the first test',
                status: 'success',
                failureMessage: undefined,
              },
              {
                name: 'the out-of-root setup hook ran before the second test too',
                status: 'success',
                failureMessage: undefined,
              },
            ],
          })
        ),
      ),
    )

    scenario(
      'A helper module outside the root declares a test when it loads',
      Gherkin.Do.pipe(
        Given('a project whose test file imports a helper from a sibling directory outside the root')(
          'sandbox',
          () =>
            provideSuite(
              outOfRootSandboxOf({
                projectFiles: [{ name: 'helper-consumer.test.ts', source: HELPER_CONSUMER_SOURCE }],
                sharedFiles: [{ name: 'helper.ts', source: HELPER_SOURCE }],
              }),
            ),
        ),
        When('the file runs')('outcome', (s) => Effect.map(s.sandbox.runSuite, outcomeOf)),
        Then('the test the out-of-root helper declared registers and runs')((s, expect) =>
          expect({ status: s.outcome.status, results: s.outcome.results }).toEqual({
            status: 'complete',
            results: [
              {
                name: 'the out-of-root helper declared this test',
                status: 'success',
                failureMessage: undefined,
              },
              { name: 'the importing file still runs its own test', status: 'success', failureMessage: undefined },
            ],
          })
        ),
      ),
    )

    scenario(
      'A linked workspace package outside the root declares a test when it loads',
      Gherkin.Do.pipe(
        Given('a project whose test file imports a package linked out of the workspace store')(
          'sandbox',
          () =>
            provideSuite(
              outOfRootSandboxOf({
                projectFiles: [{ name: 'linked-consumer.test.ts', source: LINKED_CONSUMER_SOURCE }],
                linkedPackages: [
                  { name: 'out-of-root-pkg', files: [{ name: 'index.js', source: LINKED_PACKAGE_SOURCE }] },
                ],
              }),
            ),
        ),
        When('the file runs')('outcome', (s) => Effect.map(s.sandbox.runSuite, outcomeOf)),
        Then('the test the linked package declared registers and runs')((s, expect) =>
          expect({ status: s.outcome.status, results: s.outcome.results }).toEqual({
            status: 'complete',
            results: [
              {
                name: 'the linked workspace package declared this test',
                status: 'success',
                failureMessage: undefined,
              },
              { name: 'the importing file still runs its own test', status: 'success', failureMessage: undefined },
            ],
          })
        ),
      ),
    )
  })
