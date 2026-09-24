export const STATE_KEY = Symbol.for('@systemfsoftware/stryker-js/vm-runner')

const STATE_EXPR = `Symbol.for(${JSON.stringify(STATE_KEY.description)})`

/**
 * The first-party `vitest` module served to sandbox test files: registration
 * surface from the run's harness api, assertions and mocking re-exported from
 * the user's real installed Vitest.
 */
export const VITEST_HARNESS_URL = 'vmrunner-harness:vitest'

export const EFFECT_VITEST_HARNESS_URL = 'vmrunner-harness:@effect/vitest'

export const GHERKIN_HARNESS_URL = 'vmrunner-harness:@systemfsoftware/effect-gherkin-spec'

const vitestHarnessSource = `
const state = globalThis[${STATE_EXPR}]
const { describe, suite, it, test, hooks } = state.api
export { describe, suite, it, test }
export const beforeAll = hooks.beforeAll
export const afterAll = hooks.afterAll
export const beforeEach = hooks.beforeEach
export const afterEach = hooks.afterEach
export const onTestFinished = (finalizer) => hooks.onTestFinished(finalizer)
export const expect = state.expect
export const vi = state.vi
export const assert = state.expect
`

const effectVitestHarnessSource = `
const state = globalThis[${STATE_EXPR}]
export const it = state.effectVitest.it
export const layer = state.effectVitest.layer
export const describe = state.api.describe
export const expect = state.expect
export const vi = state.vi
`

const gherkinHarnessSource = `
export * from '@systemfsoftware/effect-gherkin-spec'
const state = globalThis[${STATE_EXPR}]
export const it = state.effectVitest.it
export const layer = state.effectVitest.layer
export const describe = state.api.describe
`

const HARNESS_SOURCES: Record<string, string> = {
  [VITEST_HARNESS_URL]: vitestHarnessSource,
  [EFFECT_VITEST_HARNESS_URL]: effectVitestHarnessSource,
  [GHERKIN_HARNESS_URL]: gherkinHarnessSource,
}

export const harnessSourceFor = (url: string): string | undefined => HARNESS_SOURCES[url]

const SPECIFIER_URLS: Record<string, string> = {
  vitest: VITEST_HARNESS_URL,
  '@effect/vitest': EFFECT_VITEST_HARNESS_URL,
  '@systemfsoftware/effect-gherkin-spec': GHERKIN_HARNESS_URL,
}

export const harnessUrlForSpecifier = (specifier: string): string | undefined => SPECIFIER_URLS[specifier]
