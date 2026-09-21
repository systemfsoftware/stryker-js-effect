import { STATE_KEY } from './global-state.js'

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
export const onTestFinished = hooks.onTestFinished
export const expect = state.expect
export const vi = state.vi
export * from 'vitest'
`

const effectVitestHarnessSource = `
const state = globalThis[${STATE_EXPR}]
export const it = state.effectVitest.it
export const layer = state.effectVitest.layer
export const describe = state.api.describe
export const expect = state.expect
export const vi = state.vi
export * from 'vitest'
`

const gherkinHarnessSource = `
export * from '@systemfsoftware/effect-gherkin-spec'
const state = globalThis[${STATE_EXPR}]
export const it = state.effectVitest.it
export const layer = state.effectVitest.layer
export const describe = state.api.describe
`

export const harnessSourceFor = (url: string): string | undefined => {
  if (url === VITEST_HARNESS_URL) {
    return vitestHarnessSource
  }
  if (url === EFFECT_VITEST_HARNESS_URL) {
    return effectVitestHarnessSource
  }
  if (url === GHERKIN_HARNESS_URL) {
    return gherkinHarnessSource
  }
  return undefined
}

export const harnessUrlForSpecifier = (specifier: string): string | undefined => {
  if (specifier === 'vitest') {
    return VITEST_HARNESS_URL
  }
  if (specifier === '@effect/vitest') {
    return EFFECT_VITEST_HARNESS_URL
  }
  if (specifier === '@systemfsoftware/effect-gherkin-spec') {
    return GHERKIN_HARNESS_URL
  }
  return undefined
}
