import fc from 'fast-check'
import { inject, vi } from 'vitest'
import { propertyRuns } from './property-runs.js'

fc.configureGlobal({ numRuns: propertyRuns })

const propertySeed = inject('propertySeed')
const seeded = propertySeed === undefined ? {} : { seed: propertySeed }

/**
 * @type {(tester: import('@effect/vitest').Vitest.Methods) => import('@effect/vitest').Vitest.Methods}
 */
const withPropertyBudget = (tester) => {
  /** @type {import('@effect/vitest').Vitest.Methods['prop']} */
  const propWithBudget = (name, arbitraries, self, timeout) => {
    const { arbitrary, ...options } = typeof timeout === 'number' ? { timeout } : (timeout ?? {})
    tester.prop(name, arbitraries, self, { ...options, arbitrary: { runs: propertyRuns, ...seeded, ...arbitrary } })
  }

  return new Proxy(tester, {
    get: (
      target,
      property,
      receiver,
    ) => (property === 'prop' ? propWithBudget : Reflect.get(target, property, receiver)),
  })
}

vi.mock('@effect/vitest', (importOriginal) =>
  Promise.resolve(importOriginal()).then((mod) => {
    const effectVitest = /** @type {typeof import('@effect/vitest')} */ (mod)
    return { ...effectVitest, it: withPropertyBudget(effectVitest.it) }
  }))
