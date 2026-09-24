import { describe, it } from '@effect/vitest'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type DrainProperty,
  DrainPropertySpec,
  RegistrySpecSchema,
  type RegistryTestSpec,
  type TestSpec,
} from '../../tests/__fixtures__/drain-pipeline.schema.js'
import {
  DrainCompleted,
  type DrainOutcome,
  drainRegistry,
  DrainRegistryCommand,
  DrainTimedOut,
  PlannedTestView,
  type TestOutcome,
} from '../drain-registry.workflow.js'
import { createRegistry, planRun } from '../registry.handle.js'
import type { TestRegistry } from '../registry.schema.js'

const DrainTypeId = Symbol.for('@systemfsoftware/stryker-vm-harness/DrainDecision')

const viewOf = (test: TestSpec): PlannedTestView =>
  PlannedTestView.make({
    fullName: test.name,
    file: '',
    seq: 1,
    inverted: test.inverted,
    skipped: test.mode === 'skip' || test.mode === 'todo',
  })

const outcomesOf = (spec: DrainProperty): Record<string, TestOutcome> =>
  spec.test.shouldThrow ? { '1': { failureMessage: 'failure in test 1' } } : {}

const registryOfSpecs = (specs: ReadonlyArray<RegistryTestSpec>): TestRegistry => {
  const registry = createRegistry()
  const suiteCache = new Map<string, number>()

  for (const spec of specs) {
    let suiteIds: readonly number[] = []
    if (spec.suiteName !== undefined) {
      let suiteId = suiteCache.get(spec.suiteName)
      if (suiteId === undefined) {
        const suite = registry.registerSuite(spec.suiteName, [], spec.suiteMode ?? 'run')
        suiteId = suite.id
        suiteCache.set(spec.suiteName, suiteId)
      }
      suiteIds = [suiteId]
    }
    registry.registerTest(spec.name, suiteIds, spec.mode, false, () => {})
  }
  return registry
}

describe('drainRegistry property tests', () => {
  it.prop('∀d_Decision_≡DrainBrand', [DrainPropertySpec], ([spec]) => {
    const command = DrainRegistryCommand.make({
      plan: [viewOf(spec.test)],
      timedOut: spec.timedOut,
      outcomes: outcomesOf(spec),
      lateRejections: spec.lateRejections,
    })
    const result = drainRegistry(command)
    const decision = Result.isSuccess(result) ? result.success : undefined
    if (decision === undefined) {
      return false
    }
    return Object.getOwnPropertySymbols(decision).includes(DrainTypeId)
  })

  it.prop('∀c_DrainCommand_≡ExpectedOutcome', [DrainPropertySpec], ([spec]) => {
    const command = DrainRegistryCommand.make({
      plan: [viewOf(spec.test)],
      timedOut: spec.timedOut,
      outcomes: outcomesOf(spec),
      lateRejections: spec.lateRejections,
    })
    const result = drainRegistry(command)
    if (!Result.isSuccess(result)) {
      return false
    }
    const outcome: DrainOutcome = result.success

    if (spec.timedOut) {
      return outcome.kind === 'timeout' && S.is(DrainTimedOut)(outcome)
    }

    if (outcome.kind !== 'complete' || !S.is(DrainCompleted)(outcome)) {
      return false
    }
    const lateExpected = (spec.lateRejections ?? []).length > 0
    if (outcome.tests.length !== (lateExpected ? 2 : 1)) {
      return false
    }
    const drained = outcome.tests[0]
    if (drained === undefined) {
      return false
    }
    const skipExpected: boolean = spec.test.mode === 'skip' || spec.test.mode === 'todo'
    if (skipExpected) {
      return drained.status === 'skipped' && drained.failureMessage === undefined
    }
    const threw = spec.test.shouldThrow
    const expectedStatus = threw === spec.test.inverted ? 'success' : 'failed'
    if (drained.status !== expectedStatus) {
      return false
    }
    if (threw && drained.failureMessage !== 'failure in test 1') {
      return false
    }
    if (
      !threw && spec.test.inverted && drained.failureMessage !== `${drained.fullName} was expected to fail, but passed`
    ) {
      return false
    }
    if (!threw && !spec.test.inverted && drained.failureMessage !== undefined) {
      return false
    }
    if (drained.timeSpentMs !== 0) {
      return false
    }
    if (!lateExpected) {
      return true
    }
    const last = outcome.tests[1]
    if (last === undefined) {
      return false
    }
    return last.fullName === 'unhandled rejection' &&
      last.file === '' &&
      last.status === 'failed' &&
      last.failureMessage === (spec.lateRejections ?? []).join('\n') &&
      last.timeSpentMs === 0
  })
})

describe('planRun property tests', () => {
  it.prop('∀reg_PlanRun_≡PlanRun', [RegistrySpecSchema], ([specs]) => {
    const registry = registryOfSpecs(specs)
    const plan1 = planRun(registry)
    const plan2 = planRun(registry)

    const lengthMatches = plan1.length === registry.tests.length && plan2.length === plan1.length
    if (!lengthMatches) {
      return false
    }

    const indicesMatch = plan1.every((item, i) => item.index === i)
    if (!indicesMatch) {
      return false
    }

    return plan1.every((item, i) => {
      const other = plan2[i]
      if (other === undefined) {
        return false
      }
      return (
        item.fullName === other.fullName &&
        item.skipped === other.skipped &&
        item.index === other.index
      )
    })
  })

  it.prop('∀reg_PlanRun_∈UniqueNames', [RegistrySpecSchema], ([specs]) => {
    const registry = registryOfSpecs(specs)
    const plan = planRun(registry)
    const fullNames = plan.map((p) => p.fullName)
    const uniqueNames = new Set(fullNames)
    return uniqueNames.size === fullNames.length
  })
  it.prop('∀reg_PlanRun_=SkipPolicy', [RegistrySpecSchema], ([specs]) => {
    const registry = registryOfSpecs(specs)
    const plan = planRun(registry)

    const hasOnly = registry.tests.some((t) => t.mode === 'only') ||
      [...registry.suites.values()].some((s) => s.mode === 'only')

    return plan.every((p) => {
      const suiteMode = Option.flatMap(
        Option.fromNullishOr(p.test.suiteIds[0]),
        (id) => Option.map(Option.fromNullishOr(registry.suites.get(id)), (suite) => suite.mode),
      ).pipe(Option.getOrUndefined)
      const isExplicitSkip = p.test.mode === 'skip' || p.test.mode === 'todo'
      const isSuiteSkip = suiteMode === 'skip' || suiteMode === 'todo'
      const isExplicitOnly = p.test.mode === 'only' || suiteMode === 'only'

      if (hasOnly) {
        if (isExplicitOnly) {
          return p.skipped === (isExplicitSkip || isSuiteSkip)
        }
        return p.skipped === true
      }
      return p.skipped === (isExplicitSkip || isSuiteSkip)
    })
  })
})
