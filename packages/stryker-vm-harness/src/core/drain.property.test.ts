import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { DrainCompleted, drainRegistry, DrainRegistryCommand, DrainTimedOut, TestOutcomeSchema } from './drain.js'
import { createRegistry, type TestRegistry } from './registry.js'

const DrainTypeId = Symbol.for('@systemfsoftware/stryker-vm-harness/DrainDecision')

const TestModeSchema = S.Literals(['run', 'skip', 'only', 'todo'])

const TestSpecSchema = S.Struct({
  name: S.String.check(S.isMinLength(1), S.isMaxLength(20)),
  mode: TestModeSchema,
  inverted: S.Boolean,
  shouldThrow: S.Boolean,
})

type TestSpec = S.Schema.Type<typeof TestSpecSchema>

const NonEmptyStringSchema = S.String.check(S.isMinLength(1))

const DrainPropertySpec = S.Struct({
  timedOut: S.Boolean,
  tests: S.Array(TestSpecSchema),
  lateRejections: S.optional(S.Array(NonEmptyStringSchema)),
})

const buildRegistryFromSpecs = (specs: ReadonlyArray<TestSpec>): TestRegistry => {
  const registry = createRegistry()
  for (const spec of specs) {
    registry.registerTest(spec.name, [], spec.mode, spec.inverted, () => {})
  }
  return registry
}

describe('drainRegistry property tests', () => {
  it.prop('∀d_Decision_carriesDrainBrand', [DrainPropertySpec], ([spec]) => {
    const registry = buildRegistryFromSpecs(spec.tests)
    const outcomes: Record<string, S.Schema.Type<typeof TestOutcomeSchema>> = {}
    for (const [i, test] of spec.tests.entries()) {
      if (test.shouldThrow) {
        outcomes[String(i + 1)] = { failureMessage: `failure in test ${i + 1}` }
      }
    }
    const command = DrainRegistryCommand.make({
      registry,
      timedOut: spec.timedOut,
      outcomes,
      lateRejections: spec.lateRejections,
    })
    const result = drainRegistry(command)
    const decision = Result.isSuccess(result) ? result.success : undefined
    if (decision === undefined) {
      return false
    }
    return Object.getOwnPropertySymbols(decision).includes(DrainTypeId)
  })

  it.prop('∀c_DrainCommand_yieldsCorrectOutcome', [DrainPropertySpec], ([spec]) => {
    const registry = buildRegistryFromSpecs(spec.tests)
    const outcomes: Record<string, S.Schema.Type<typeof TestOutcomeSchema>> = {}
    for (const [i, test] of spec.tests.entries()) {
      if (test.shouldThrow) {
        outcomes[String(i + 1)] = { failureMessage: `failure in test ${i + 1}` }
      }
    }
    const command = DrainRegistryCommand.make({
      registry,
      timedOut: spec.timedOut,
      outcomes,
      lateRejections: spec.lateRejections,
    })
    const result = drainRegistry(command)
    if (!Result.isSuccess(result)) {
      return false
    }
    const outcome = result.success

    if (spec.timedOut) {
      return outcome.kind === 'timeout' && S.is(DrainTimedOut)(outcome)
    }

    if (outcome.kind !== 'complete' || !S.is(DrainCompleted)(outcome)) {
      return false
    }
    const lateCount = (spec.lateRejections ?? []).length > 0 ? 1 : 0
    const testCountExpected = spec.tests.length + lateCount
    if (outcome.tests.length !== testCountExpected) {
      return false
    }

    const hasOnly = spec.tests.some((t) => t.mode === 'only')
    for (let i = 0; i < spec.tests.length; i++) {
      const inputTest = spec.tests[i]!
      const drained = outcome.tests[i]!

      const isOnlySkipped = hasOnly && inputTest.mode !== 'only'
      if (inputTest.mode === 'skip' || inputTest.mode === 'todo' || isOnlySkipped) {
        if (drained.status !== 'skipped') return false
        if (drained.failureMessage !== undefined) return false
      } else {
        const threw = inputTest.shouldThrow
        const expectedStatus = threw === inputTest.inverted ? 'success' : 'failed'
        if (drained.status !== expectedStatus) return false
        if (threw && drained.failureMessage !== `failure in test ${i + 1}`) return false
        if (
          !threw && inputTest.inverted &&
          drained.failureMessage !== `${drained.fullName} was expected to fail, but passed`
        ) return false
        if (!threw && !inputTest.inverted && drained.failureMessage !== undefined) return false
        const expectedTime = outcomes[String(i + 1)]?.timeSpentMs ?? 0
        if (drained.timeSpentMs !== expectedTime) return false
      }
    }
    const lateRejections = spec.lateRejections ?? []
    if (lateRejections.length > 0) {
      const last = outcome.tests[outcome.tests.length - 1]!
      if (last.fullName !== 'unhandled rejection') return false
      if (last.file !== '') return false
      if (last.status !== 'failed') return false
      if (last.failureMessage !== lateRejections.join('\n')) return false
      if (last.timeSpentMs !== 0) return false
    } else {
      if (outcome.tests.length !== spec.tests.length) return false
    }

    return true
  })
})
