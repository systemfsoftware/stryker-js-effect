import { describe, expect, it } from 'vitest'
import { createHarnessApi, createRegistry, fullNameOf, hooksFor, planRun } from './registry.js'
import type { RegistryTestApi } from './registry.js'

describe('registry harness API and deduplication', () => {
  it('initializes registry with empty file and increments sequence ids', () => {
    const registry = createRegistry()
    expect(registry.files.current).toBe('')
    const suite1 = registry.registerSuite('s1', [], 'run')
    const suite2 = registry.registerSuite('s2', [], 'run')
    expect(suite1.id).toBe(1)
    expect(suite2.id).toBe(2)
    const test1 = registry.registerTest('t1', [], 'run', false, undefined)
    expect(test1.seq).toBe(1)
    expect(test1.file).toBe('')
  })

  it('exercises harness API describe, it, and hooks', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    let beforeRan = false
    let afterRan = false
    let beforeEachRan = false
    let afterEachRan = false

    api.hooks.beforeAll(() => {
      beforeRan = true
    })
    api.hooks.afterAll(() => {
      afterRan = true
    })
    api.hooks.beforeEach(() => {
      beforeEachRan = true
    })
    api.hooks.afterEach(() => {
      afterEachRan = true
    })

    expect(() => api.hooks.onTestFinished(() => {})).toThrow(
      'onTestFinished must be called while a test is running',
    )

    api.describe('my suite', (suiteApi) => {
      api.hooks.beforeAll(() => {})
      api.hooks.afterAll(() => {})
      api.hooks.beforeEach(() => {})
      api.hooks.afterEach(() => {})
      suiteApi('inner test', () => {})
      suiteApi.skip('skipped test', () => {})
      suiteApi.only('only test', () => {})
      suiteApi.todo('todo test')
      suiteApi.fails('failing test', () => {})
      suiteApi.each([1, 2], 'each test %i', () => {})
      suiteApi.for([1, 2], 'for test %i', () => {})
    })

    api.describe.skip('skipped suite', () => {})
    api.describe.only('only suite', () => {})
    api.describe.for([1, 2], 'for suite %i', () => {})
    api.it.skip('skipped it', () => {})
    api.it.only('only it', () => {})
    api.it.todo('todo it')
    api.it.fails('fails it', () => {})
    api.it.each([1, 2], 'each it %i', () => {})
    api.it.for([1, 2], 'for it %i', () => {})

    const curriedDescribe = api.describe.each([1]) as (
      name: string,
      body: (args: unknown, api: unknown) => void,
    ) => void
    curriedDescribe('curried suite %i', () => {})

    const curriedIt = api.it.each([1]) as (name: string, fn: (args: unknown, ctx: unknown) => void) => void
    curriedIt('curried it %i', () => {})
    api.test('top-level test', { timeout: 100 }, () => {})
    api.test('top-level test direct', () => {})
    api.it('it with options', { timeout: 50 }, () => {})
    api.it('it without options', () => {})
    const itNested = api.it.each([['nested', 1]]) as (name: string, fn: (args: unknown, ctx: unknown) => void) => void
    itNested('nested array each %s %i', () => {})
    const descNested = api.describe.each([['nested-suite', 2]]) as (
      name: string,
      body: (args: unknown, api: unknown) => void,
    ) => void
    descNested('nested array suite %s %i', () => {})
    api.it.each([1], 'direct each it %i', () => {})
    api.describe.each([1], 'direct each describe %i', () => {})
    api.it.skip.each([1], 'direct skip each %i', () => {})
    api.it.only.each([1], 'direct only each %i', () => {})
    api.describe.skip.each([1], 'direct skip suite each %i', () => {})
    api.describe.only.each([1], 'direct only suite each %i', () => {})
    api.it.todo('todo it direct')
    api.describe.todo('todo describe direct')
    api.it.fails('fails direct', () => {})
    api.suite('top-level suite', (s) => {
      s('suite test', () => {})
      api.describe('inner suite', (inner) => {
        api.hooks.beforeEach(() => {})
        inner('inner test', () => {})
      })
    })
    const unnamedSuite = registry.registerSuite('', [], 'run')
    registry.registerTest('t-unnamed', [unnamedSuite.id], 'run', false, () => {})
    const plan = planRun(registry)
    expect(plan.some((p) => p.fullName === ' > t-unnamed')).toBe(true)
    const dummyContext = {
      signal: new AbortController().signal,
      task: { type: 'test' as const, name: 'dummy' },
      onTestFinished: () => {},
    }
    const beforeHooks = hooksFor(registry, 'beforeAll', [1])
    expect(beforeHooks.length).toBe(2)
    beforeHooks[0]?.(dummyContext)
    expect(beforeRan).toBe(true)

    const afterHooks = hooksFor(registry, 'afterAll', [1])
    expect(afterHooks.length).toBe(2)
    afterHooks[0]?.(dummyContext)
    expect(afterRan).toBe(true)

    const beforeEachHooks = hooksFor(registry, 'beforeEach', [1])
    expect(beforeEachHooks.length).toBe(2)
    beforeEachHooks[0]?.(dummyContext)
    expect(beforeEachRan).toBe(true)

    const afterEachHooks = hooksFor(registry, 'afterEach', [1])
    expect(afterEachHooks.length).toBe(2)
    afterEachHooks[0]?.(dummyContext)
    expect(afterEachRan).toBe(true)
  })

  it('disambiguates duplicate test names with seen counter', () => {
    const registry = createRegistry()
    registry.registerTest('dup', [], 'run', false, () => {})
    registry.registerTest('dup', [], 'run', false, () => {})
    registry.registerTest('dup', [], 'run', false, () => {})
    const plan = planRun(registry)
    expect(plan[0]?.fullName).toBe('dup')
    expect(plan[1]?.fullName).toBe('dup [1]')
    expect(plan[2]?.fullName).toBe('dup [2]')
  })

  it('plans tests with exact only/skip/todo inheritance', () => {
    const registry = createRegistry()
    const s1 = registry.registerSuite('s1-only', [], 'only')
    const s2 = registry.registerSuite('s2-skip', [], 'skip')
    const s3 = registry.registerSuite('s3-run', [], 'run')

    registry.registerTest('t-in-only', [s1.id], 'run', false, () => {})
    registry.registerTest('t-skip-in-only', [s1.id], 'skip', false, () => {})
    registry.registerTest('t-todo-in-only', [s1.id], 'todo', false, () => {})
    registry.registerTest('t-only-in-skip', [s2.id], 'only', false, () => {})
    registry.registerTest('t-in-skip', [s2.id], 'run', false, () => {})
    registry.registerTest('t-in-run', [s3.id], 'run', false, () => {})
    registry.registerTest('t-top-only', [], 'only', false, () => {})
    registry.registerTest('t-top-run', [], 'run', false, () => {})
    registry.registerTest('t-top-skip', [], 'skip', false, () => {})

    const plan = planRun(registry)
    const planned = Object.fromEntries(plan.map((p) => [p.fullName, p.skipped]))

    expect(planned['s1-only > t-in-only']).toBe(false)
    expect(planned['s1-only > t-skip-in-only']).toBe(true)
    expect(planned['s1-only > t-todo-in-only']).toBe(true)
    expect(planned['s2-skip > t-only-in-skip']).toBe(true)
    expect(planned['s2-skip > t-in-skip']).toBe(true)
    expect(planned['s3-run > t-in-run']).toBe(true)
    expect(planned['t-top-only']).toBe(false)
    expect(planned['t-top-run']).toBe(true)
    expect(planned['t-top-skip']).toBe(true)
  })
})

describe('registry variant overloads and plan semantics', () => {
  const dummyContext = () => ({
    signal: new AbortController().signal,
    task: { type: 'test' as const, name: 't' },
    onTestFinished: () => {},
  })

  it('resolves fn-only and options+fn signatures to the given functions', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    const a = () => 'a'
    const b = () => 'b'
    api.it('fn only', a)
    api.it('options fn', { timeout: 50 }, b)
    const plan = planRun(registry)
    expect(plan[0]?.test.fn).toBe(a)
    expect(plan[1]?.test.fn).toBe(b)
  })

  it('registers uncurried it.each rows with row passthrough', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    const rows: unknown[] = []
    const contexts: unknown[] = []
    api.it.each([[1], [2]], 'row %i', (row, context) => {
      rows.push(row)
      contexts.push(context)
    })
    const plan = planRun(registry)
    expect(plan.map((p) => p.fullName)).toEqual(['row 1', 'row 2'])
    expect(plan[0]?.test.inverted).toBe(false)
    plan[0]?.test.fn?.(dummyContext())
    plan[1]?.test.fn?.(dummyContext())
    expect(rows).toEqual([1, 2])
    expect(contexts[0]).toBeDefined()
    expect(contexts[1]).toBeDefined()
  })

  it('spreads multi-element tuple rows into name tokens and fn args', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    const calls: Array<readonly unknown[]> = []
    api.it.each(
      [['a', 1], ['b', 2]],
      'n %s %i',
      (...args: readonly unknown[]) => {
        calls.push(args)
        return undefined
      },
    )
    const plan = planRun(registry)
    expect(plan.map((p) => p.fullName)).toEqual(['n a 1', 'n b 2'])
    plan[0]?.test.fn?.(dummyContext())
    plan[1]?.test.fn?.(dummyContext())
    expect(calls[0]?.slice(0, -1)).toEqual(['a', 1])
    expect(calls[1]?.slice(0, -1)).toEqual(['b', 2])
    expect(calls[0]?.at(-1)).toBeDefined()
    expect(calls[1]?.at(-1)).toBeDefined()
  })

  it('registers uncurried describe variant each suites', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    api.describe.only.each([[1]], 'only suite %i', (...args: readonly unknown[]) => {
      ;(args.at(-1) as RegistryTestApi)('inner', () => {})
    })
    api.describe.skip.each([[2]], 'skip suite %i', (...args: readonly unknown[]) => {
      ;(args.at(-1) as RegistryTestApi)('inner', () => {})
    })
    api.describe.each([[3]], 'run suite %i', (...args: readonly unknown[]) => {
      ;(args.at(-1) as RegistryTestApi)('inner', () => {})
    })
    const plan = planRun(registry)
    expect(plan.map((p) => [p.fullName, p.skipped])).toEqual([
      ['only suite 1 > inner', false],
      ['skip suite 2 > inner', true],
      ['run suite 3 > inner', true],
    ])
    expect([...registry.suites.values()].map((suite) => suite.mode)).toEqual(['only', 'skip', 'run'])
  })

  it('tags variant modes and inversion flags', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    api.it('plain', () => {})
    api.it.skip('skipped', () => {})
    api.it.only('focused', () => {})
    api.it.fails('failing', () => {})
    api.it.todo('todo')
    const plan = planRun(registry)
    expect(plan[0]?.test.mode).toBe('run')
    expect(plan[0]?.test.inverted).toBe(false)
    expect(plan[1]?.test.mode).toBe('skip')
    expect(plan[1]?.test.inverted).toBe(false)
    expect(plan[2]?.test.mode).toBe('only')
    expect(plan[2]?.test.inverted).toBe(false)
    expect(plan[3]?.test.mode).toBe('run')
    expect(plan[3]?.test.inverted).toBe(true)
    expect(plan[4]?.test.mode).toBe('todo')
    expect(plan[4]?.test.inverted).toBe(false)
    expect(plan[4]?.test.fn).toBeUndefined()
  })

  it('scopes suite hooks away from root', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    api.describe('s', () => {
      api.hooks.beforeEach(() => {})
      api.hooks.afterEach(() => {})
      api.hooks.afterAll(() => {})
    })
    api.hooks.beforeAll(() => {})
    const suiteId = [...registry.suites.keys()][0] as number
    expect(hooksFor(registry, 'beforeEach', [suiteId]).length).toBe(1)
    expect(hooksFor(registry, 'beforeEach', []).length).toBe(0)
    expect(hooksFor(registry, 'afterEach', [suiteId]).length).toBe(1)
    expect(hooksFor(registry, 'afterEach', []).length).toBe(0)
    expect(hooksFor(registry, 'afterAll', [suiteId]).length).toBe(1)
    expect(hooksFor(registry, 'afterAll', []).length).toBe(0)
    expect(hooksFor(registry, 'beforeAll', [suiteId]).length).toBe(1)
  })

  it('names tests through the suite chain', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    api.describe('outer', (inner) => {
      inner('in', () => {})
    })
    const plan = planRun(registry)
    const registered = plan[0]?.test
    expect(registered).toBeDefined()
    expect(fullNameOf(registry, registered as NonNullable<typeof registered>)).toBe('outer > in')
  })

  it('opens base variant suites and todo suites', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    api.describe.skip('base skip suite', (inner) => {
      inner('t', () => {})
    })
    api.describe.only('base only suite', (inner) => {
      inner('t', () => {})
    })
    api.describe.todo('todo suite')
    expect([...registry.suites.values()].map((suite) => suite.mode)).toEqual(['skip', 'only', 'todo'])
    const plan = planRun(registry)
    const skippedBySuite = Object.fromEntries(plan.map((p) => [p.fullName, p.skipped]))
    expect(skippedBySuite['base skip suite > t']).toBe(true)
    expect(skippedBySuite['base only suite > t']).toBe(false)
  })

  it('wires onTestFinished to the running test context', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    let captured: unknown
    registry.currentTest = {
      signal: new AbortController().signal,
      task: { type: 'test', name: 't' },
      onTestFinished: (finalizer) => {
        captured = finalizer
      },
    }
    const finalizer = () => {}
    api.hooks.onTestFinished(finalizer)
    registry.currentTest = undefined
    expect(captured).toBe(finalizer)
    expect(() => api.hooks.onTestFinished(finalizer)).toThrow(
      'onTestFinished must be called while a test is running',
    )
  })

  it('falls back to empty names for unknown suite ids', () => {
    const registry = createRegistry()
    const registered = registry.registerTest('orphan', [999], 'run', false, () => {})
    expect(fullNameOf(registry, registered)).toBe(' > orphan')
  })

  it('skips tests inside todo suites', () => {
    const registry = createRegistry()
    const todoSuite = registry.registerSuite('todo suite', [], 'todo')
    registry.registerTest('inside', [todoSuite.id], 'run', false, () => {})
    const plan = planRun(registry)
    expect(plan[0]?.fullName).toBe('todo suite > inside')
    expect(plan[0]?.skipped).toBe(true)
  })
})
