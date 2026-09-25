import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import { environmentSandboxOf, outcomeOf, sandboxProject, suiteFileLayer } from './__fixtures__/environment-sandbox.js'

const Feature = makeFeature({ it })

const provideSuite = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E> => Effect.provide(effect, suiteFileLayer)

const captureFile = {
  name: 'capture.test.ts',
  source: [
    "import { expect, test } from 'vitest'",
    '',
    'const capturedDocument = document',
    '',
    "test('a reference captured while loading still points at the live document', () => {",
    '  expect(capturedDocument).toBe(document)',
    '})',
    '',
    "test('a page element can be built and the page address matches the project setting', () => {",
    "  const element = document.createElement('div')",
    "  element.textContent = 'hello dom'",
    "  expect(element.textContent).toBe('hello dom')",
    "  expect(window.location.origin).toBe('https://happy-dom.example')",
    '})',
  ].join('\n'),
}

Feature('Giving each test file the environment its project asks for')
  .withLayer(suiteFileLayer)
  .live('the sandbox writes real files and loads real environment packages for the project')
  .body(({ scenario }) => {
    scenario(
      'A file in a browser-like project finds the document and honours the configured page address',
      Gherkin.Do.pipe(
        Given('a project whose files run under happy-dom at a configured page address')(
          'sandbox',
          () =>
            provideSuite(environmentSandboxOf(
              [captureFile],
              () =>
                sandboxProject({
                  environment: 'happy-dom',
                  environmentOptions: { happyDOM: { url: 'https://happy-dom.example/dashboard' } },
                }),
            )),
        ),
        When('the file runs')('outcome', (s) => Effect.map(s.sandbox.runSuite, outcomeOf)),
        Then('the file passes with the document present and the page address honoured')((s, expect) =>
          expect({ status: s.outcome.status, results: s.outcome.results }).toEqual({
            status: 'complete',
            results: [
              {
                name: 'a reference captured while loading still points at the live document',
                status: 'success',
                failureMessage: undefined,
              },
              {
                name: 'a page element can be built and the page address matches the project setting',
                status: 'success',
                failureMessage: undefined,
              },
            ],
          })
        ),
      ),
    )

    scenario(
      'A file that asks for jsdom gets it while its node neighbour stays untouched',
      Gherkin.Do.pipe(
        Given('two files in one run: one whose project is jsdom and one whose project stays node')(
          'sandbox',
          () =>
            provideSuite(environmentSandboxOf(
              [
                {
                  name: 'needs-jsdom.test.ts',
                  source: [
                    "import { expect, test } from 'vitest'",
                    '',
                    "test('the file that asked for jsdom sees its page', () => {",
                    '  expect(document).toBeDefined()',
                    "  expect(window.location.href).toBe('https://jsdom.example/page')",
                    '})',
                  ].join('\n'),
                },
                {
                  name: 'plain.test.ts',
                  source: [
                    "import { expect, test } from 'vitest'",
                    '',
                    "test('the neighbouring node file sees no document', () => {",
                    '  expect(globalThis.document).toBeUndefined()',
                    '})',
                  ].join('\n'),
                },
              ],
              (file) =>
                file.endsWith('needs-jsdom.test.ts')
                  ? sandboxProject({
                    environment: 'jsdom',
                    environmentOptions: { jsdom: { url: 'https://jsdom.example/page' } },
                  })
                  : sandboxProject({}),
            )),
        ),
        When('both files are loaded and then run, one after the other')(
          'outcome',
          (s) => Effect.map(s.sandbox.runSuite, outcomeOf),
        ),
        Then('the jsdom file saw its page and the node file saw no document at all')((s, expect) =>
          expect({ status: s.outcome.status, results: s.outcome.results }).toEqual({
            status: 'complete',
            results: [
              {
                name: 'the file that asked for jsdom sees its page',
                status: 'success',
                failureMessage: undefined,
              },
              {
                name: 'the neighbouring node file sees no document',
                status: 'success',
                failureMessage: undefined,
              },
            ],
          })
        ),
      ),
    )

    scenario(
      'A missing environment package stops the run with the install hint',
      Gherkin.Do.pipe(
        Given('a project that asks for an environment no package provides')(
          'sandbox',
          () =>
            provideSuite(environmentSandboxOf(
              [{
                name: 'lonely.test.ts',
                source: [
                  "import { test } from 'vitest'",
                  '',
                  "test('a test that never gets to run', () => {})",
                ].join('\n'),
              }],
              () => sandboxProject({ environment: 'does-not-exist' }),
            )),
        ),
        When('the run is attempted')('outcome', (s) => Effect.map(s.sandbox.runSuite, outcomeOf)),
        Then('the run never starts and the failure names the missing package with the install hint')((s, expect) =>
          expect({
            status: s.outcome.status,
            namesPackage: (s.outcome.message ?? '').includes(
              "Cannot find dependency 'vitest-environment-does-not-exist'",
            ),
            givesInstallHint: (s.outcome.message ?? '').includes('npm i -D vitest-environment-does-not-exist'),
          }).toEqual({ status: 'init-failed', namesPackage: true, givesInstallHint: true })
        ),
      ),
    )
  })
