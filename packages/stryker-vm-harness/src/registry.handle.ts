import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import type {
  HarnessTestContext,
  HookSets,
  PlannedTest,
  RegisteredSuite,
  RegisteredTest,
  TestMode,
  TestRegistry,
} from './registry.schema.js'

const emptyHookSets = (): HookSets => ({
  beforeAll: [],
  afterAll: [],
  beforeEach: [],
  afterEach: [],
})

export const createRegistry = (): TestRegistry => {
  const suites = new Map<number, RegisteredSuite>()
  const tests: RegisteredTest[] = []
  const rootHooks = emptyHookSets()
  const suiteHooks = new Map<number, HookSets>()
  const frames: { current: readonly number[] } = { current: [] }
  const files = { current: '' }
  let sequence = 0
  let suiteSequence = 0
  let running: HarnessTestContext | undefined
  return {
    suites,
    tests,
    rootHooks,
    suiteHooks,
    frames,
    files,
    get currentTest() {
      return running
    },
    set currentTest(value) {
      running = value
    },
    registerSuite(name, parentIds, mode) {
      suiteSequence += 1
      const suite: RegisteredSuite = { id: suiteSequence, name, parentIds, mode }
      suites.set(suite.id, suite)
      suiteHooks.set(suite.id, emptyHookSets())
      return suite
    },
    registerTest(name, suiteIds, mode, inverted, fn) {
      sequence += 1
      const registered: RegisteredTest = {
        type: 'test',
        seq: sequence,
        name,
        file: files.current,
        suiteIds,
        mode,
        inverted,
        fn,
      }
      tests.push(registered)
      return registered
    },
  }
}

const suiteNameOf = (registry: TestRegistry, id: number): string =>
  Option.getOrElse(
    Option.map(Option.fromNullishOr(registry.suites.get(id)), (suite) => suite.name),
    () => '',
  )

const fullNameOf = (registry: TestRegistry, test: RegisteredTest): string =>
  [...test.suiteIds.map((id) => suiteNameOf(registry, id)), test.name].join(' > ')

const isHeldMode = (mode: TestMode | undefined): boolean =>
  Match.value(mode).pipe(
    Match.when('skip', () => true),
    Match.when('todo', () => true),
    Match.orElse(() => false),
  )

const isOnlyMode = (mode: TestMode | undefined): boolean =>
  Match.value(mode).pipe(
    Match.when('only', () => true),
    Match.orElse(() => false),
  )

const suiteHolds = (registry: TestRegistry, id: number): boolean =>
  isHeldMode(registry.suites.get(id)?.mode)

const suiteOnly = (registry: TestRegistry, id: number): boolean =>
  isOnlyMode(registry.suites.get(id)?.mode)

const isSkipped = (registry: TestRegistry, test: RegisteredTest, onlyPresent: boolean): boolean =>
  Boolean.or(
    Boolean.or(isHeldMode(test.mode), test.suiteIds.some((id) => suiteHolds(registry, id))),
    Boolean.and(
      onlyPresent,
      Boolean.not(Boolean.or(isOnlyMode(test.mode), test.suiteIds.some((id) => suiteOnly(registry, id)))),
    ),
  )

const containsOnly = (registry: TestRegistry): boolean =>
  Boolean.or(
    registry.tests.some((test) => isOnlyMode(test.mode)),
    [...registry.suites.values()].some((suite) => isOnlyMode(suite.mode)),
  )

export const planRun = (registry: TestRegistry): ReadonlyArray<PlannedTest> => {
  const onlyPresent = containsOnly(registry)
  const nameCounts = new Map<string, number>()
  return registry.tests.map((test, index) => {
    const fullName = fullNameOf(registry, test)
    const seen = Option.getOrElse(Option.fromNullishOr(nameCounts.get(fullName)), () => 0)
    nameCounts.set(fullName, seen + 1)
    const distinctName = Match.value(seen === 0).pipe(
      Match.when(true, () => fullName),
      Match.when(false, () => `${fullName} [${seen}]`),
      Match.exhaustive,
    )
    return {
      test,
      fullName: distinctName,
      chain: test.suiteIds,
      skipped: isSkipped(registry, test, onlyPresent),
      index,
    }
  })
}
