import { describe, it } from '@effect/vitest'
import * as S from 'effect/Schema'
import { createRegistry, planRun, type TestRegistry } from './registry.js'

const TestModeSchema = S.Literals(['run', 'skip', 'only', 'todo'])

const TestSpecSchema = S.Struct({
  name: S.String.check(S.isMinLength(1), S.isMaxLength(20)),
  mode: TestModeSchema,
  suiteName: S.optional(S.String.check(S.isMinLength(1), S.isMaxLength(20))),
  suiteMode: S.optional(TestModeSchema),
})

type TestSpec = S.Schema.Type<typeof TestSpecSchema>

const RegistrySpecSchema = S.Array(TestSpecSchema)

const buildRegistry = (specs: ReadonlyArray<TestSpec>): TestRegistry => {
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

describe('planRun property tests', () => {
  it.prop('∀reg_planRun_isDeterministicAndPreservesCount', [RegistrySpecSchema], ([specs]) => {
    const registry = buildRegistry(specs)
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

  it.prop('∀reg_planRun_uniqueFullNames', [RegistrySpecSchema], ([specs]) => {
    const registry = buildRegistry(specs)
    const plan = planRun(registry)
    const fullNames = plan.map((p) => p.fullName)
    const uniqueNames = new Set(fullNames)
    return uniqueNames.size === fullNames.length
  })
  it.prop('∀reg_planRun_onlyAndSkipInvariants', [RegistrySpecSchema], ([specs]) => {
    const registry = buildRegistry(specs)
    const plan = planRun(registry)

    const hasOnly = registry.tests.some((t) => t.mode === 'only') ||
      [...registry.suites.values()].some((s) => s.mode === 'only')

    return plan.every((p) => {
      const suite = p.test.suiteIds.length > 0 ? registry.suites.get(p.test.suiteIds[0]!) : undefined
      const isExplicitSkip = p.test.mode === 'skip' || p.test.mode === 'todo'
      const isSuiteSkip = suite?.mode === 'skip' || suite?.mode === 'todo'
      const isExplicitOnly = p.test.mode === 'only' || suite?.mode === 'only'

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
