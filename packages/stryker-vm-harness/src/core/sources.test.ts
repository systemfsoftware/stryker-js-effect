import { describe, expect, it } from 'vitest'
import {
  EFFECT_VITEST_HARNESS_URL,
  GHERKIN_HARNESS_URL,
  harnessSourceFor,
  harnessUrlForSpecifier,
  STATE_KEY,
  VITEST_HARNESS_URL,
} from './sources.js'

describe('sources', () => {
  it('maps specifiers to harness URLs', () => {
    expect(harnessUrlForSpecifier('vitest')).toBe('vmrunner-harness:vitest')
    expect(harnessUrlForSpecifier('@effect/vitest')).toBe('vmrunner-harness:@effect/vitest')
    expect(harnessUrlForSpecifier('@systemfsoftware/effect-gherkin-spec')).toBe(
      'vmrunner-harness:@systemfsoftware/effect-gherkin-spec',
    )

    expect(harnessUrlForSpecifier('unknown-module')).toBeUndefined()
  })

  it('returns harness sources for valid URLs', () => {
    const vitestSource = harnessSourceFor(VITEST_HARNESS_URL)
    expect(vitestSource).toBeDefined()
    expect(vitestSource).toContain(STATE_KEY.description)
    expect(vitestSource).toContain('export { describe, suite, it, test }')
    expect(vitestSource).toContain('export const expect = state.expect')

    const effectSource = harnessSourceFor(EFFECT_VITEST_HARNESS_URL)
    expect(effectSource).toBeDefined()
    expect(effectSource).toContain('export const it = state.effectVitest.it')

    const gherkinSource = harnessSourceFor(GHERKIN_HARNESS_URL)
    expect(gherkinSource).toBeDefined()
    expect(gherkinSource).toContain("export * from '@systemfsoftware/effect-gherkin-spec'")

    expect(harnessSourceFor('unknown-url')).toBeUndefined()
  })
})
