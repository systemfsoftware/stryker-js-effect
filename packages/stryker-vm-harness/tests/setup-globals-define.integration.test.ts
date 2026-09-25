import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import {
  environmentSandboxOf,
  globalString,
  outcomeOf,
  sandboxProject,
  suiteFileLayer,
} from './__fixtures__/environment-sandbox.js'

const Feature = makeFeature({ it })

const provideSuite = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E> => Effect.provide(effect, suiteFileLayer)

const SETUP_SOURCE = [
  'let hookRuns = 0',
  '',
  "globalThis['setupMarker'] = 'setup ran'",
  '',
  'beforeEach(() => {',
  '  hookRuns += 1',
  "  globalThis['setupHookRuns'] = hookRuns",
  '})',
].join('\n')

const SETUP_CONSUMER_A = [
  "test('the setup left its mark before the first test', () => {",
  "  expect(globalThis['setupMarker']).toBe('setup ran')",
  "  expect(globalThis['setupHookRuns']).toBe(1)",
  '})',
  '',
  "test('the setup hook ran before this test too', () => {",
  "  expect(globalThis['setupHookRuns']).toBe(2)",
  '})',
].join('\n')

const SETUP_CONSUMER_B = [
  "test('a second file sees the setup freshly evaluated for it alone', () => {",
  "  expect(globalThis['setupMarker']).toBe('setup ran')",
  "  expect(globalThis['setupHookRuns']).toBe(1)",
  '})',
].join('\n')

const GLOBALS_SOURCE = [
  "describe('globals mode', () => {",
  "  test('the suite runs without importing the test api', () => {",
  "    expect(typeof test).toBe('function')",
  "    expect(typeof describe).toBe('function')",
  "    expect(typeof expect).toBe('function')",
  "    expect(typeof vi).toBe('object')",
  '  })',
  '})',
].join('\n')

const DEFINE_PROBE_SOURCE = [
  "test('the project hands the file its injected constants and environment entries', () => {",
  "  expect(__APP_VERSION__).toBe('1.2.3')",
  "  expect(app.config.level).toBe('deep')",
  "  expect(process.env['VM_PARITY_ENV']).toBe('from-env')",
  "  expect(process.env['VITE_FEATURE']).toBe('enabled')",
  '})',
].join('\n')

const DEFINE_PROJECT = sandboxProject({
  globals: true,
  define: {
    __APP_VERSION__: JSON.stringify('1.2.3'),
    'app.config.level': JSON.stringify('deep'),
    'import.meta.env.VITE_FEATURE': JSON.stringify('enabled'),
  },
  env: { VM_PARITY_ENV: 'from-env' },
})

Feature('Preparing each test file with globals, setup files, and injected constants')
  .withLayer(suiteFileLayer)
  .live('the sandbox writes real project files and injects constants into the loaded graph')
  .body(({ scenario }) => {
    scenario(
      'A suite that never imports the test api still runs',
      Gherkin.Do.pipe(
        Given('a project with the global test api switched on')(
          'sandbox',
          () =>
            provideSuite(environmentSandboxOf(
              [{ name: 'globals-mode.test.ts', source: GLOBALS_SOURCE }],
              () => sandboxProject({ globals: true }),
            )),
        ),
        When('the file runs')('outcome', (s) => Effect.map(s.sandbox.runSuite, outcomeOf)),
        Then('the file passes without ever importing the test api')((s, expect) =>
          expect({ status: s.outcome.status, results: s.outcome.results }).toEqual({
            status: 'complete',
            results: [{
              name: 'globals mode > the suite runs without importing the test api',
              status: 'success',
              failureMessage: undefined,
            }],
          })
        ),
      ),
    )

    scenario(
      'A setup file is re-read for every file and its hooks apply to that file alone',
      Gherkin.Do.pipe(
        Given('a project with one setup file and two suites to load')(
          'sandbox',
          () =>
            provideSuite(environmentSandboxOf(
              [
                { name: 'setup.ts', source: SETUP_SOURCE },
                { name: 'first.test.ts', source: SETUP_CONSUMER_A },
                { name: 'second.test.ts', source: SETUP_CONSUMER_B },
              ],
              (file) =>
                file.endsWith('setup.ts')
                  ? sandboxProject({ globals: true })
                  : sandboxProject({ globals: true, setupFiles: ['setup.ts'] }),
            )),
        ),
        When('both suites run in order')('outcome', (s) => Effect.map(s.sandbox.runSuite, outcomeOf)),
        Then('each suite saw the setup hook fire for it alone, in file order')((s, expect) =>
          expect({ status: s.outcome.status, results: s.outcome.results }).toEqual({
            status: 'complete',
            results: [
              { name: 'the setup left its mark before the first test', status: 'success', failureMessage: undefined },
              { name: 'the setup hook ran before this test too', status: 'success', failureMessage: undefined },
              {
                name: 'a second file sees the setup freshly evaluated for it alone',
                status: 'success',
                failureMessage: undefined,
              },
            ],
          })
        ),
      ),
    )

    scenario(
      'Injected constants and environment entries reach the file and are cleared when the graph is let go',
      Gherkin.Do.pipe(
        Given('a project that injects constants, a nested constant, and environment entries')(
          'sandbox',
          () =>
            provideSuite(
              environmentSandboxOf([{ name: 'define.test.ts', source: DEFINE_PROBE_SOURCE }], () => DEFINE_PROJECT),
            ),
        ),
        When('the file runs and the loaded graph is then let go')(
          'outcome',
          (s) => Effect.map(s.sandbox.runSuite.pipe(Effect.ensuring(s.sandbox.dispose)), outcomeOf),
        ),
        Then('the file saw every injected value and nothing of it remains')((s, expect) =>
          expect({
            status: s.outcome.status,
            results: s.outcome.results,
            cleared: [globalString('__APP_VERSION__'), globalString('app'), globalString('VM_PARITY_ENV')],
          }).toEqual({
            status: 'complete',
            results: [{
              name: 'the project hands the file its injected constants and environment entries',
              status: 'success',
              failureMessage: undefined,
            }],
            cleared: [undefined, undefined, undefined],
          })
        ),
      ),
    )
  })
