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
const api = state.api
export const describe = api.describe
export const suite = api.suite
export const it = api.it
export const test = api.it
export const beforeAll = api.beforeAll
export const afterAll = api.afterAll
export const beforeEach = api.beforeEach
export const afterEach = api.afterEach
export const aroundAll = api.aroundAll
export const aroundEach = api.aroundEach
export const onTestFailed = api.onTestFailed
export const onTestFinished = api.onTestFinished
export const inject = api.inject
export const expect = state.expect
export const vi = state.vi
export const vitest = state.vi
const runnerRecordArtifact = (task, artifact) => {
  if (typeof artifact !== 'object' || artifact === null || typeof artifact.type !== 'string') {
    throw new TypeError('Test artifact requires "type" to be set.')
  }
  if (Array.isArray(artifact.attachments)) {
    for (const attachment of artifact.attachments) {
      if (attachment.body == null && attachment.path == null) {
        throw new TypeError('Test attachment requires "body" or "path" to be set. Both are missing.')
      }
      if (attachment.body != null && attachment.path != null) {
        throw new TypeError('Test attachment requires only one of "body" or "path" to be set. Both are specified.')
      }
      if (attachment.path != null && attachment.bodyEncoding != null) {
        throw new TypeError('Test attachment with "path" should not have "bodyEncoding" specified.')
      }
    }
  }
  if (artifact.type === 'internal:annotation') {
    return artifact
  }
  const stored = Array.isArray(task.artifacts) ? task.artifacts : []
  task.artifacts = [...stored, artifact]
  return artifact
}
export const recordArtifact = runnerRecordArtifact
export * from 'vitest'
`

const effectVitestHarnessSource = `
const state = globalThis[${STATE_EXPR}]
const effectIt = state.effectVitest.it
export const it = effectIt
export const layer = effectIt.layer
export const effect = effectIt.effect
export const live = effectIt.live
export const prop = effectIt.prop
export const flakyTest = effectIt.flakyTest
export const describe = state.api.describe
export const expect = state.expect
export const vi = state.vi
export const vitest = state.vi
export * from '@effect/vitest'
`

const gherkinHarnessSource = `
const state = globalThis[${STATE_EXPR}]
const effectIt = state.effectVitest.it
export const it = effectIt
export const layer = effectIt.layer
export const describe = state.api.describe
export const expect = state.expect
export const vi = state.vi
export * from '@systemfsoftware/effect-gherkin-spec'
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
