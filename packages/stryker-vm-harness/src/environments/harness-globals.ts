import type { HarnessApi, HookApi, RegistrySuiteApi, RegistryTestApi } from '../registry.schema.js'

export type VitestGlobalName =
  | 'suite'
  | 'test'
  | 'describe'
  | 'it'
  | 'chai'
  | 'expect'
  | 'assert'
  | 'expectTypeOf'
  | 'assertType'
  | 'vitest'
  | 'vi'
  | 'beforeAll'
  | 'afterAll'
  | 'beforeEach'
  | 'afterEach'
  | 'onTestFinished'
  | 'onTestFailed'
  | 'aroundEach'
  | 'aroundAll'

export const GLOBAL_API_NAMES: ReadonlyArray<VitestGlobalName> = [
  'suite',
  'test',
  'describe',
  'it',
  'chai',
  'expect',
  'assert',
  'expectTypeOf',
  'assertType',
  'vitest',
  'vi',
  'beforeAll',
  'afterAll',
  'beforeEach',
  'afterEach',
  'onTestFinished',
  'onTestFailed',
  'aroundEach',
  'aroundAll',
]

export interface VitestNamespaceSurface {
  readonly chai: object | undefined
  readonly expect: object | undefined
  readonly assert: object | undefined
  readonly expectTypeOf: object | undefined
  readonly assertType: object | undefined
  readonly vitest: object | undefined
  readonly vi: object | undefined
  readonly onTestFailed: object | undefined
  readonly aroundEach: object | undefined
  readonly aroundAll: object | undefined
}

export interface HarnessGlobalSources {
  readonly api: HarnessApi
  readonly expect: object | undefined
  readonly vi: object | undefined
  readonly vitest: VitestNamespaceSurface
}

export type GlobalBindings = Readonly<Record<VitestGlobalName, object | undefined>>

const suiteEntriesOf = (
  api: HarnessApi,
): ReadonlyArray<readonly [VitestGlobalName, RegistrySuiteApi | RegistryTestApi]> => [
  ['suite', api.suite],
  ['test', api.test],
  ['describe', api.describe],
  ['it', api.it],
]

const hookEntriesOf = (hooks: HookApi): ReadonlyArray<readonly [VitestGlobalName, HookApi[keyof HookApi]]> => [
  ['beforeAll', hooks.beforeAll],
  ['afterAll', hooks.afterAll],
  ['beforeEach', hooks.beforeEach],
  ['afterEach', hooks.afterEach],
  ['onTestFinished', hooks.onTestFinished],
]

const prefer = (declared: object | undefined, fallback: object | undefined): object | undefined => declared ?? fallback

const boundOf = (sources: HarnessGlobalSources): Partial<Record<VitestGlobalName, object | undefined>> => ({
  expect: prefer(sources.expect, sources.vitest.expect),
  assert: prefer(sources.expect, sources.vitest.assert),
  vi: prefer(sources.vi, sources.vitest.vi),
})

const bindEntries = (
  bound: Partial<Record<VitestGlobalName, object | undefined>>,
  entries: ReadonlyArray<readonly [VitestGlobalName, object | undefined]>,
): void => {
  for (const [name, entry] of entries) bound[name] = entry
}

const harnessBound = (sources: HarnessGlobalSources): Partial<Record<VitestGlobalName, object | undefined>> => {
  const bound = boundOf(sources)
  bindEntries(bound, [...suiteEntriesOf(sources.api), ...hookEntriesOf(sources.api.hooks)])
  return bound
}

export const harnessGlobalBindings = (sources: HarnessGlobalSources): GlobalBindings => {
  const bound = harnessBound(sources)
  const vitestGlobal: object = Object.assign({}, sources.vitest, bound)
  return {
    suite: bound.suite,
    test: bound.test,
    describe: bound.describe,
    it: bound.it,
    chai: sources.vitest.chai,
    expect: bound.expect,
    assert: bound.assert,
    expectTypeOf: sources.vitest.expectTypeOf,
    assertType: sources.vitest.assertType,
    vitest: vitestGlobal,
    vi: bound.vi,
    beforeAll: bound.beforeAll,
    afterAll: bound.afterAll,
    beforeEach: bound.beforeEach,
    afterEach: bound.afterEach,
    onTestFinished: bound.onTestFinished,
    onTestFailed: sources.vitest.onTestFailed,
    aroundEach: sources.vitest.aroundEach,
    aroundAll: sources.vitest.aroundAll,
  }
}
