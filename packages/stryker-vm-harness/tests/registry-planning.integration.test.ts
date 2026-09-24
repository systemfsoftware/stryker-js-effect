import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  createHarnessApi,
  createRegistry,
  DrainCompleted,
  type DrainedStatus,
  type DrainOutcome,
  drainRegistry,
} from '@systemfsoftware/stryker-vm-harness'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

const FINIALIZER_GUARD_MESSAGE = 'onTestFinished must be called while a test is running'

type DrainedTests = DrainCompleted['tests']

const drainedTestsOf = (outcome: DrainOutcome): DrainedTests => {
  if (outcome.kind !== 'complete') {
    throw new Error('the harness drain timed out before it could report outcomes')
  }
  return outcome.tests
}

const namesOf = (tests: DrainedTests): readonly string[] => tests.map((test) => test.fullName)

const statusByName = (tests: DrainedTests): Readonly<Record<string, DrainedStatus>> => {
  const statuses: Record<string, DrainedStatus> = {}
  for (const test of tests) {
    statuses[test.fullName] = test.status
  }
  return statuses
}

const messageByName = (tests: DrainedTests): Readonly<Record<string, string | undefined>> => {
  const messages: Record<string, string | undefined> = {}
  for (const test of tests) {
    messages[test.fullName] = test.failureMessage
  }
  return messages
}

const Feature = makeFeature({ it, layer })

Feature('Planning a run from registered suites and tests')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A registration records an empty file and successive identifiers',
      Gherkin.Do.pipe(
        Given('two suites and a test registered against a fresh registry')('fixture', () =>
          Effect.sync(() => {
            const registry = createRegistry()
            const firstSuite = registry.registerSuite('first suite', [], 'run')
            const secondSuite = registry.registerSuite('second suite', [], 'run')
            const registered = registry.registerTest('the only test', [], 'run', false, () => {})
            return { firstSuite, registered, registry, secondSuite }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('the suites receive successive identifiers and the test carries an empty file')((s) => {
          const tests = drainedTestsOf(s.outcome)
          expect(s.fixture.firstSuite.id).toBe(1)
          expect(s.fixture.secondSuite.id).toBe(2)
          expect(s.fixture.registered.seq).toBe(1)
          expect(s.fixture.registered.file).toBe('')
          expect(tests[0]?.file).toBe('')
          expect(statusByName(tests)['the only test']).toBe('success')
        }),
      ),
    )

    scenario(
      'Every declaration shape reaches the plan through the harness API',
      Gherkin.Do.pipe(
        Given('a registry where hooks announce themselves and every declaration shape is used')(
          'fixture',
          () =>
            Effect.sync(() => {
              const hookLog: string[] = []
              const registry = createRegistry()
              const api = createHarnessApi(registry)
              api.hooks.beforeAll(() => {
                hookLog.push('root before all')
              })
              api.hooks.afterAll(() => {
                hookLog.push('root after all')
              })
              api.hooks.beforeEach(() => {
                hookLog.push('root before each')
              })
              api.hooks.afterEach(() => {
                hookLog.push('root after each')
              })
              api.describe('chosen suite', (suiteApi) => {
                api.hooks.beforeAll(() => {
                  hookLog.push('suite before all')
                })
                api.hooks.afterAll(() => {
                  hookLog.push('suite after all')
                })
                api.hooks.beforeEach(() => {
                  hookLog.push('suite before each')
                })
                api.hooks.afterEach(() => {
                  hookLog.push('suite after each')
                })
                suiteApi('inner test', () => {
                  hookLog.push('inner test ran')
                })
                suiteApi.skip('skipped test', () => {
                  hookLog.push('skipped test ran')
                })
                suiteApi.only('only test', () => {
                  hookLog.push('only test ran')
                })
                suiteApi.todo('todo test')
                suiteApi.fails('failing test', () => {
                  hookLog.push('failing test ran')
                })
                suiteApi.each([1, 2], 'each test %i', (row) => {
                  hookLog.push(`each test ran ${String(row)}`)
                })
                suiteApi.for([1, 2], 'for test %i', (row) => {
                  hookLog.push(`for test ran ${String(row)}`)
                })
              })
              api.describe.skip('skipped suite', () => {})
              api.describe.only('only suite', () => {})
              api.describe.for([1, 2], 'for suite %i', () => {})
              api.it.skip('skipped it', () => {})
              api.it.only('only it', () => {})
              api.it.todo('todo it')
              api.it.fails('fails it', () => {})
              api.it.each([1, 2], 'each it %i', (row) => {
                hookLog.push(`each it ran ${String(row)}`)
              })
              api.it.for([1, 2], 'for it %i', (row) => {
                hookLog.push(`for it ran ${String(row)}`)
              })
              api.test('top-level test', { timeout: 100 }, () => {})
              api.test('top-level test direct', () => {})
              api.it('it with options', { timeout: 50 }, () => {})
              api.it('it without options', () => {})
              api.suite('top-level suite', (suiteApi) => {
                suiteApi('suite test', () => {})
                api.describe('inner suite', (innerSuiteApi) => {
                  api.hooks.beforeEach(() => {
                    hookLog.push('nested suite before each')
                  })
                  innerSuiteApi('inner test', () => {})
                })
              })
              const unnamedSuite = registry.registerSuite('', [], 'run')
              registry.registerTest('t-unnamed', [unnamedSuite.id], 'run', false, () => {})
              return { api, hookLog, registry }
            }),
        ),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('each declaration is planned under its expected name and status')((s) => {
          const tests = drainedTestsOf(s.outcome)
          expect(namesOf(tests)).toEqual([
            'chosen suite > inner test',
            'chosen suite > skipped test',
            'chosen suite > only test',
            'chosen suite > todo test',
            'chosen suite > failing test',
            'chosen suite > each test 1',
            'chosen suite > each test 2',
            'chosen suite > for test 1',
            'chosen suite > for test 2',
            'skipped it',
            'only it',
            'todo it',
            'fails it',
            'each it 1',
            'each it 2',
            'for it 1',
            'for it 2',
            'top-level test',
            'top-level test direct',
            'it with options',
            'it without options',
            'top-level suite > suite test',
            'top-level suite > inner suite > inner test',
            ' > t-unnamed',
          ])
          expect(statusByName(tests)).toEqual({
            ' > t-unnamed': 'skipped',
            'chosen suite > each test 1': 'skipped',
            'chosen suite > each test 2': 'skipped',
            'chosen suite > failing test': 'skipped',
            'chosen suite > for test 1': 'skipped',
            'chosen suite > for test 2': 'skipped',
            'chosen suite > inner test': 'skipped',
            'chosen suite > only test': 'success',
            'chosen suite > skipped test': 'skipped',
            'chosen suite > todo test': 'skipped',
            'each it 1': 'skipped',
            'each it 2': 'skipped',
            'fails it': 'skipped',
            'for it 1': 'skipped',
            'for it 2': 'skipped',
            'it with options': 'skipped',
            'it without options': 'skipped',
            'only it': 'success',
            'skipped it': 'skipped',
            'todo it': 'skipped',
            'top-level suite > inner suite > inner test': 'skipped',
            'top-level suite > suite test': 'skipped',
            'top-level test': 'skipped',
            'top-level test direct': 'skipped',
          })
        }),
        Then('the hooks fire in the drained lifecycle order')((s) => {
          expect(s.fixture.hookLog).toEqual([
            'root before all',
            'suite before all',
            'root before each',
            'suite before each',
            'only test ran',
            'suite after each',
            'root after each',
            'suite after all',
            'root before each',
            'root after each',
            'root after all',
          ])
        }),
        Then('a finalizer may not be registered outside a running test')((s) => {
          expect(() => s.fixture.api.hooks.onTestFinished(() => {})).toThrow(FINIALIZER_GUARD_MESSAGE)
        }),
      ),
    )

    scenario(
      'Tests that share a name are reported under distinct names',
      Gherkin.Do.pipe(
        Given('a registry with three tests of the same name')('fixture', () =>
          Effect.sync(() => {
            const ran: string[] = []
            const registry = createRegistry()
            const api = createHarnessApi(registry)
            api.it('duplicate name', () => {
              ran.push('first')
            })
            api.it('duplicate name', () => {
              ran.push('second')
            })
            api.it('duplicate name', () => {
              ran.push('third')
            })
            return { ran, registry }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('each occurrence keeps its turn and is reported apart from the others')((s) => {
          const tests = drainedTestsOf(s.outcome)
          expect(namesOf(tests)).toEqual(['duplicate name', 'duplicate name [1]', 'duplicate name [2]'])
          expect(statusByName(tests)).toEqual({
            'duplicate name': 'success',
            'duplicate name [1]': 'success',
            'duplicate name [2]': 'success',
          })
          expect(s.fixture.ran).toEqual(['first', 'second', 'third'])
        }),
      ),
    )

    scenario(
      'A focused declaration narrows the run while skipped and pending ones stay out of it',
      Gherkin.Do.pipe(
        Given('suites and tests carrying focus, skip and pending marks')('fixture', () =>
          Effect.sync(() => {
            const registry = createRegistry()
            const focusedSuite = registry.registerSuite('focused suite', [], 'only')
            const skippedSuite = registry.registerSuite('skipped suite', [], 'skip')
            const plainSuite = registry.registerSuite('plain suite', [], 'run')
            registry.registerTest('inside the focused suite', [focusedSuite.id], 'run', false, () => {})
            registry.registerTest('skipped inside the focused suite', [focusedSuite.id], 'skip', false, () => {})
            registry.registerTest('pending inside the focused suite', [focusedSuite.id], 'todo', false, () => {})
            registry.registerTest('focused inside the skipped suite', [skippedSuite.id], 'only', false, () => {})
            registry.registerTest('inside the skipped suite', [skippedSuite.id], 'run', false, () => {})
            registry.registerTest('inside the plain suite', [plainSuite.id], 'run', false, () => {})
            registry.registerTest('focused at the top', [], 'only', false, () => {})
            registry.registerTest('plain at the top', [], 'run', false, () => {})
            registry.registerTest('skipped at the top', [], 'skip', false, () => {})
            return { registry }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('only the focused declarations run and every other one is held out')((s) => {
          expect(statusByName(drainedTestsOf(s.outcome))).toEqual({
            'focused at the top': 'success',
            'focused suite > inside the focused suite': 'success',
            'focused suite > pending inside the focused suite': 'skipped',
            'focused suite > skipped inside the focused suite': 'skipped',
            'plain at the top': 'skipped',
            'plain suite > inside the plain suite': 'skipped',
            'skipped at the top': 'skipped',
            'skipped suite > focused inside the skipped suite': 'skipped',
            'skipped suite > inside the skipped suite': 'skipped',
          })
        }),
      ),
    )

    scenario(
      'A declared test runs the function it was given',
      Gherkin.Do.pipe(
        Given('two tests declared with a bare function and with options')('fixture', () =>
          Effect.sync(() => {
            const ran: string[] = []
            const registry = createRegistry()
            const api = createHarnessApi(registry)
            api.it('declared with a bare function', () => {
              ran.push('bare function body')
            })
            api.it('declared with options', { timeout: 50 }, () => {
              ran.push('options body')
            })
            return { ran, registry }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('each declaration runs exactly the body it was given')((s) => {
          const tests = drainedTestsOf(s.outcome)
          expect(namesOf(tests)).toEqual(['declared with a bare function', 'declared with options'])
          expect(statusByName(tests)).toEqual({
            'declared with a bare function': 'success',
            'declared with options': 'success',
          })
          expect(s.fixture.ran).toEqual(['bare function body', 'options body'])
        }),
      ),
    )

    scenario(
      'Each row hands its value to the test body',
      Gherkin.Do.pipe(
        Given('a test declared once per row of values')('fixture', () =>
          Effect.sync(() => {
            const rows: number[] = []
            const argCounts: number[] = []
            const registry = createRegistry()
            const api = createHarnessApi(registry)
            api.it.each(
              [[1], [2]],
              'row %i',
              (row, ...rest) => {
                rows.push(Number(row))
                argCounts.push(rest.length + 1)
                return row
              },
            )
            return { argCounts, registry, rows }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('every row renders its own name and reaches the body with a run context')((s) => {
          const tests = drainedTestsOf(s.outcome)
          expect(namesOf(tests)).toEqual(['row 1', 'row 2'])
          expect(statusByName(tests)).toEqual({ 'row 1': 'success', 'row 2': 'success' })
          expect(s.fixture.rows).toEqual([1, 2])
          expect(s.fixture.argCounts).toEqual([1, 1])
        }),
      ),
    )

    scenario(
      'A table row spreads into the rendered name and the test arguments',
      Gherkin.Do.pipe(
        Given('a test declared once per row of a small table')('fixture', () =>
          Effect.sync(() => {
            const rendered: string[] = []
            const argCounts: number[] = []
            const registry = createRegistry()
            const api = createHarnessApi(registry)
            api.it.each(
              [['a', 1], ['b', 2]],
              'n %s %i',
              (first, ...rest) => {
                rendered.push(`${String(first)} ${String(rest[0])}`)
                argCounts.push(rest.length + 1)
                return first
              },
            )
            return { argCounts, registry, rendered }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('each row names itself from the table and spreads across the body arguments')((s) => {
          const tests = drainedTestsOf(s.outcome)
          expect(namesOf(tests)).toEqual(['n a 1', 'n b 2'])
          expect(s.fixture.rendered).toEqual(['a 1', 'b 2'])
          expect(s.fixture.argCounts).toEqual([2, 2])
        }),
      ),
    )

    scenario(
      'Each-declared suites keep their focus and skip modes',
      Gherkin.Do.pipe(
        Given('one focused, one skipped and one plain suite, each declared per row')(
          'fixture',
          () =>
            Effect.sync(() => {
              const registry = createRegistry()
              const api = createHarnessApi(registry)
              api.describe.only.each([[1]], 'only suite %i', () => {
                api.it('inner', () => {})
              })
              api.describe.skip.each([[2]], 'skip suite %i', () => {
                api.it('inner', () => {})
              })
              api.describe.each([[3]], 'run suite %i', () => {
                api.it('inner', () => {})
              })
              return { registry }
            }),
        ),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('the focused suite runs and the skipped and unfocused ones are held out')((s) => {
          expect(statusByName(drainedTestsOf(s.outcome))).toEqual({
            'only suite 1 > inner': 'success',
            'run suite 3 > inner': 'skipped',
            'skip suite 2 > inner': 'skipped',
          })
        }),
      ),
    )

    scenario(
      'Declaration modes decide whether a test runs, waits or expects to fail',
      Gherkin.Do.pipe(
        Given('one registry of plain, skipped, pending and inverted tests')('plainFixture', () =>
          Effect.sync(() => {
            const ran: string[] = []
            const registry = createRegistry()
            const api = createHarnessApi(registry)
            api.it('plain passing', () => {
              ran.push('plain passing ran')
            })
            api.it('plain failing', () => {
              throw new Error('the plain test threw')
            })
            api.it.skip('skipped', () => {
              ran.push('skipped ran')
            })
            api.it.todo('pending')
            api.it.fails('failing as designed', () => {
              throw new Error('the inverted test threw')
            })
            api.it.fails('passing against design', () => {
              ran.push('passing against design ran')
            })
            return { ran, registry }
          })),
        Given('another registry holding one focused test and its unfocused sibling')(
          'focusedFixture',
          () =>
            Effect.sync(() => {
              const registry = createRegistry()
              const api = createHarnessApi(registry)
              api.it.only('focused', () => {})
              api.it('unfocused sibling', () => {})
              return { registry }
            }),
        ),
        When('both registries are drained')('outcome', (s) =>
          Effect.all([
            Effect.promise(() => drainRegistry(s.plainFixture.registry, undefined)),
            Effect.promise(() => drainRegistry(s.focusedFixture.registry, undefined)),
          ])),
        Then('plain tests run, held-out ones never start, and inverted ones judge in reverse')((s) => {
          const [plainOutcome, focusedOutcome] = s.outcome
          const plainTests = drainedTestsOf(plainOutcome)
          expect(statusByName(plainTests)).toEqual({
            'failing as designed': 'success',
            'passing against design': 'failed',
            'plain failing': 'failed',
            'plain passing': 'success',
            'pending': 'skipped',
            'skipped': 'skipped',
          })
          expect(messageByName(plainTests)['plain failing']).toBe('the plain test threw')
          expect(messageByName(plainTests)['failing as designed']).toBe(undefined)
          expect(messageByName(plainTests)['passing against design']).toBe('Expect test to fail')
          expect(s.plainFixture.ran).toEqual(['plain passing ran', 'passing against design ran'])
          expect(statusByName(drainedTestsOf(focusedOutcome))).toEqual({
            focused: 'success',
            'unfocused sibling': 'skipped',
          })
        }),
      ),
    )

    scenario(
      'A hook declared inside a suite never runs for tests outside it',
      Gherkin.Do.pipe(
        Given('a suite with lifecycle hooks of its own beside a test at the top level')(
          'fixture',
          () =>
            Effect.sync(() => {
              const hookLog: string[] = []
              const registry = createRegistry()
              const api = createHarnessApi(registry)
              api.describe('scoped suite', () => {
                api.hooks.beforeEach(() => {
                  hookLog.push('suite before each')
                })
                api.hooks.afterEach(() => {
                  hookLog.push('suite after each')
                })
                api.hooks.afterAll(() => {
                  hookLog.push('suite after all')
                })
                api.it('inside the suite', () => {})
              })
              api.hooks.beforeAll(() => {
                hookLog.push('root before all')
              })
              api.it('at the root', () => {})
              return { hookLog, registry }
            }),
        ),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('the suite hooks surround only their own test')((s) => {
          expect(s.fixture.hookLog).toEqual([
            'root before all',
            'suite before each',
            'suite after each',
            'suite after all',
          ])
        }),
      ),
    )

    scenario(
      'A test is named through every suite it sits in',
      Gherkin.Do.pipe(
        Given('a test declared inside a suite')('fixture', () =>
          Effect.sync(() => {
            const registry = createRegistry()
            const api = createHarnessApi(registry)
            api.describe('outer', (innerSuiteApi) => {
              innerSuiteApi('in', () => {})
            })
            return { registry }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('the report names the test through its suite')((s) => {
          const tests = drainedTestsOf(s.outcome)
          expect(namesOf(tests)).toEqual(['outer > in'])
          expect(statusByName(tests)).toEqual({ 'outer > in': 'success' })
        }),
      ),
    )

    scenario(
      'Suite-level focus and skip carry to the tests inside',
      Gherkin.Do.pipe(
        Given('a skipped suite, a focused suite and a pending suite')('fixture', () =>
          Effect.sync(() => {
            const registry = createRegistry()
            const api = createHarnessApi(registry)
            api.describe.skip('base skip suite', (innerSuiteApi) => {
              innerSuiteApi('t', () => {})
            })
            api.describe.only('base only suite', (innerSuiteApi) => {
              innerSuiteApi('t', () => {})
            })
            api.describe.todo('todo suite')
            return { registry }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('the skipped suite holds its test out, the focused one runs it, and the pending suite plans nothing')(
          (s) => {
            const tests = drainedTestsOf(s.outcome)
            expect(namesOf(tests)).toEqual(['base skip suite > t', 'base only suite > t'])
            expect(statusByName(tests)).toEqual({
              'base only suite > t': 'success',
              'base skip suite > t': 'skipped',
            })
          },
        ),
      ),
    )

    scenario(
      'A finalizer registered during a test runs when that test finishes',
      Gherkin.Do.pipe(
        Given('a test that registers a finalizer for itself')('fixture', () =>
          Effect.sync(() => {
            let finalizerRan = false
            const registry = createRegistry()
            const api = createHarnessApi(registry)
            api.it('registers a finalizer', () => {
              api.hooks.onTestFinished(() => {
                finalizerRan = true
              })
            })
            api.it('runs after it', () => {})
            return { api, registry, sawFinalizer: () => finalizerRan }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('the finalizer has run by the time the drain reports')((s) => {
          const tests = drainedTestsOf(s.outcome)
          expect(statusByName(tests)).toEqual({
            'registers a finalizer': 'success',
            'runs after it': 'success',
          })
          expect(s.fixture.sawFinalizer()).toBe(true)
          expect(() => s.fixture.api.hooks.onTestFinished(() => {})).toThrow(FINIALIZER_GUARD_MESSAGE)
        }),
      ),
    )

    scenario(
      'A test pointing at an unknown suite is still named',
      Gherkin.Do.pipe(
        Given('a test registered against a suite the registry does not know')('fixture', () =>
          Effect.sync(() => {
            const registry = createRegistry()
            registry.registerTest('orphan test', [999], 'run', false, () => {})
            return { registry }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('the report names the test after an empty suite')((s) => {
          const tests = drainedTestsOf(s.outcome)
          expect(namesOf(tests)).toEqual([' > orphan test'])
          expect(statusByName(tests)).toEqual({ ' > orphan test': 'success' })
        }),
      ),
    )

    scenario(
      'A test inside a pending suite is held out of the run',
      Gherkin.Do.pipe(
        Given('a plain test inside a pending suite')('fixture', () =>
          Effect.sync(() => {
            const ran: string[] = []
            const registry = createRegistry()
            const pendingSuite = registry.registerSuite('pending suite', [], 'todo')
            registry.registerTest('inside', [pendingSuite.id], 'run', false, () => {
              ran.push('inside ran')
            })
            return { ran, registry }
          })),
        When('the registry is drained')(
          'outcome',
          (s) => Effect.promise(() => drainRegistry(s.fixture.registry, undefined)),
        ),
        Then('the test is reported by its suite and held out of the run')((s) => {
          const tests = drainedTestsOf(s.outcome)
          expect(namesOf(tests)).toEqual(['pending suite > inside'])
          expect(statusByName(tests)).toEqual({ 'pending suite > inside': 'skipped' })
          expect(s.fixture.ran).toEqual([])
        }),
      ),
    )
  })
