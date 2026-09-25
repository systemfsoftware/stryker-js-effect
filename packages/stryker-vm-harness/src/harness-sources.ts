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

const lazyStatePrelude = `
const currentState = () => globalThis[${STATE_EXPR}]
const currentApi = () => {
  const state = currentState()
  if (state === undefined || state.api === undefined) {
    throw new Error('the in-memory runner is not active; this harness-served module cannot register tests')
  }
  return state.api
}
const forward = (pick) => new Proxy(pick, {
  apply: (target, thisArg, args) => Reflect.apply(pick(), thisArg, args),
  get: (target, key) => {
    const resolved = pick()
    const value = Reflect.get(resolved, key, resolved)
    return typeof value === 'function' ? value.bind(resolved) : value
  },
})
`

const vitestHarnessSource = `
${lazyStatePrelude}
export const describe = forward(() => currentApi().describe)
export const suite = describe
export const it = forward(() => currentApi().it)
export const test = it
export const beforeAll = (...args) => currentApi().beforeAll(...args)
export const afterAll = (...args) => currentApi().afterAll(...args)
export const beforeEach = (...args) => currentApi().beforeEach(...args)
export const afterEach = (...args) => currentApi().afterEach(...args)
export const aroundAll = (...args) => currentApi().aroundAll(...args)
export const aroundEach = (...args) => currentApi().aroundEach(...args)
export const onTestFailed = (...args) => currentApi().onTestFailed(...args)
export const onTestFinished = (...args) => currentApi().onTestFinished(...args)
export const inject = (...args) => currentApi().inject(...args)
export const expect = currentState().expect
export const vi = currentState().vi
export const vitest = currentState().vi
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
${lazyStatePrelude}
const effectIt = () => currentState().effectVitest.it
export const it = forward(effectIt)
export const layer = (...args) => effectIt().layer(...args)
export const effect = (...args) => effectIt().effect(...args)
export const live = (...args) => effectIt().live(...args)
export const prop = (...args) => effectIt().prop(...args)
export const flakyTest = (...args) => effectIt().flakyTest(...args)
export const describe = forward(() => currentApi().describe)
export const expect = currentState().expect
export const vi = currentState().vi
export const vitest = currentState().vi
export * from '@effect/vitest'
`

const gherkinHarnessSource = `
${lazyStatePrelude}
const effectIt = () => currentState().effectVitest.it
export const it = forward(effectIt)
export const layer = (...args) => effectIt().layer(...args)
export const describe = forward(() => currentApi().describe)
export const expect = currentState().expect
export const vi = currentState().vi
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
