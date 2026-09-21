import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { DrainCompleted, type DrainOutcome, drainRegistry, DrainRegistryCommand } from './drain.js'
import { createRegistry } from './registry.js'

const completedOf = (result: Result.Result<DrainOutcome, never>): DrainCompleted => {
  const outcome = Result.isSuccess(result) ? result.success : undefined
  if (outcome === undefined || !S.is(DrainCompleted)(outcome)) throw new Error('expected DrainCompleted')
  return outcome
}

describe('drainRegistry late rejection boundary', () => {
  it('adds no synthetic failure for defined empty late rejections', () => {
    const registry = createRegistry()
    registry.registerTest('t', [], 'run', false, () => {})
    const command = DrainRegistryCommand.make({
      registry,
      timedOut: false,
      outcomes: {},
      lateRejections: [],
    })
    const outcome = completedOf(drainRegistry(command))
    expect(outcome.tests.length).toBe(1)
    expect(outcome.tests.some((t) => t.fullName === 'unhandled rejection')).toBe(false)
  })

  it('reports a single synthetic failed test for late rejections', () => {
    const registry = createRegistry()
    registry.registerTest('t', [], 'run', false, () => {})
    const command = DrainRegistryCommand.make({
      registry,
      timedOut: false,
      outcomes: {},
      lateRejections: ['boom'],
    })
    const outcome = completedOf(drainRegistry(command))
    expect(outcome.tests.length).toBe(2)
    const last = outcome.tests[1]
    expect(last?.fullName).toBe('unhandled rejection')
    expect(last?.file).toBe('')
    expect(last?.status).toBe('failed')
    expect(last?.failureMessage).toBe('boom')
    expect(last?.timeSpentMs).toBe(0)
  })

  it('fails an inverted passing test with an expectation message', () => {
    const registry = createRegistry()
    registry.registerTest('flaky', [], 'run', true, () => {})
    const command = DrainRegistryCommand.make({ registry, timedOut: false, outcomes: {} })
    const outcome = completedOf(drainRegistry(command))
    expect(outcome.tests.length).toBe(1)
    expect(outcome.tests[0]?.status).toBe('failed')
    expect(outcome.tests[0]?.failureMessage).toBe('flaky was expected to fail, but passed')
  })
})
