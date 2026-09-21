import { describe, it } from '@effect/vitest'
import * as S from 'effect/Schema'
import { expect } from 'vitest'

import { createHarnessApi, createRegistry, formatEachName, planRun } from '../vm-harness/registry.js'

const Name = S.Literals(['alpha', 'beta', 'gamma'])
const Mode = S.Literals(['run', 'skip', 'only', 'todo'])
const TestSpec = S.Struct({ name: Name, mode: Mode })
const TestSpecs = S.Array(TestSpec)

type Spec = S.Schema.Type<typeof TestSpec>

const registerFlat = (specs: ReadonlyArray<Spec>) => {
  const registry = createRegistry()
  const api = createHarnessApi(registry)
  registry.files.current = 'suite.test.ts'
  for (const spec of specs) {
    if (spec.mode === 'skip') {
      api.it.skip(spec.name, () => {})
    } else if (spec.mode === 'only') {
      api.it.only(spec.name, () => {})
    } else if (spec.mode === 'todo') {
      api.it.todo(spec.name)
    } else {
      api.it(spec.name, () => {})
    }
  }
  return registry
}

const wouldBeSkipped = (specs: ReadonlyArray<Spec>, mode: Spec['mode']): boolean => {
  const onlyPresent = specs.some((spec) => spec.mode === 'only')
  if (mode === 'skip' || mode === 'todo') {
    return true
  }
  return onlyPresent && mode !== 'only'
}

describe('vm registry', () => {
  it.prop('∀specs_plan_≡_registration_order', [TestSpecs], ([specs]) => {
    const plan = planRun(registerFlat(specs))
    return plan.length === specs.length && plan.every((planned, index) => planned.index === index)
  })

  it.prop('∀specs_plan_names_≠', [TestSpecs], ([specs]) => {
    const plan = planRun(registerFlat(specs))
    const names = plan.map((planned) => planned.fullName)
    return new Set(names).size === names.length
  })

  it.prop('∀specs_modes_≡_planned_skipped', [TestSpecs], ([specs]) => {
    const plan = planRun(registerFlat(specs))
    return plan.every((planned) => planned.skipped === wouldBeSkipped(specs, planned.test.mode))
  })

  it.prop('∀specs_stamped_file', [TestSpecs], ([specs]) => {
    const plan = planRun(registerFlat(specs))
    return plan.every((planned) => planned.test.file === 'suite.test.ts')
  })

  it.prop('∀specs_hooks_empty_≡_no_declarations', [TestSpecs], ([specs]) => {
    const registry = registerFlat(specs)
    return (
      registry.rootHooks.beforeAll.length === 0 &&
      registry.rootHooks.afterAll.length === 0 &&
      registry.rootHooks.beforeEach.length === 0 &&
      registry.rootHooks.afterEach.length === 0
    )
  })
})

describe('suite hierarchy', () => {
  it('joins nested suite names with " > "', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    api.describe('outer', () => {
      api.describe('inner', () => {
        api.it('works', () => {})
      })
    })
    const plan = planRun(registry)
    expect(plan).toHaveLength(1)
    expect(plan[0]?.fullName).toBe('outer > inner > works')
    expect(plan[0]?.chain).toHaveLength(2)
  })

  it('expands it.each rows with formatted titles', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    api.it.each([[1], [2], [3]])('row %s', () => {})
    const plan = planRun(registry)
    expect(plan.map((planned) => planned.fullName)).toEqual(['row 1', 'row 2', 'row 3'])
  })

  it('routes only-marked tests through the only variant', () => {
    const registry = createRegistry()
    const api = createHarnessApi(registry)
    api.it('a', () => {})
    api.it.only('b', () => {})
    const plan = planRun(registry)
    expect(plan.filter((planned) => !planned.skipped).map((planned) => planned.test.name)).toEqual(['b'])
  })
})

describe('formatEachName', () => {
  it.prop('∀rows_%s_distinct_rows_≡_distinct_names', [S.Array(S.Number)], ([numbers]) => {
    const rows = numbers.map((n, index) => [`${n}#${index}`])
    const names = rows.map((row) => formatEachName('case %s', row))
    return new Set(names).size === names.length
  })

  it.prop('∀row_object_$key_≡_property', [S.Struct({ id: S.Number })], ([row]) => {
    return formatEachName('case $id', row) === `case ${row.id}`
  })
})
