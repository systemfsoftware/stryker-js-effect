import { assertEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl } from '@std/path'
import { catalogCouplingViolations, catalogEffectCouplingViolations } from './catalog-effect-coupling.ts'

const REPO_ROOT = fromFileUrl(new URL('../..', import.meta.url))

Deno.test('flags a floated pin for an effect-locked package', () => {
  const violations = catalogCouplingViolations(
    { 'effect': '4.0.0-rc.112', '@systemfsoftware/effect-cell-types': '^8' },
    [{ name: '@systemfsoftware/effect-cell-types', version: '8.1.0', effectPeer: '4.0.0-rc.112' }],
  )

  assertEquals(violations.length, 1)
  assertStringIncludes(violations[0] ?? '', 'catalog-pinned as "^8"')
})

Deno.test('flags an exact pin whose effect peer is another release', () => {
  const violations = catalogCouplingViolations(
    { 'effect': '4.0.0-rc.112', '@systemfsoftware/effect-cell-types': '8.3.1' },
    [{ name: '@systemfsoftware/effect-cell-types', version: '8.3.1', effectPeer: '4.0.0-rc.116' }],
  )

  assertEquals(violations.length, 1)
  assertStringIncludes(violations[0] ?? '', 'peers effect@4.0.0-rc.116')
})

Deno.test('judges the pinned build rather than the builds a previous pin left in the store', () => {
  const violations = catalogCouplingViolations(
    { 'effect': '4.0.0-rc.116', '@systemfsoftware/effect-cell-types': '8.3.1' },
    [
      { name: '@systemfsoftware/effect-cell-types', version: '8.1.0', effectPeer: '4.0.0-rc.112' },
      { name: '@systemfsoftware/effect-cell-types', version: '8.3.1', effectPeer: '4.0.0-rc.116' },
    ],
  )

  assertEquals(violations, [])
})

Deno.test('flags a floated effect pin in the catalog', () => {
  const violations = catalogCouplingViolations(
    { 'effect': '^4.0.0-rc.112', '@systemfsoftware/effect-cell-types': '8.1.0' },
    [{ name: '@systemfsoftware/effect-cell-types', version: '8.1.0', effectPeer: '4.0.0-rc.112' }],
  )

  assertEquals(violations.length, 1)
  assertStringIncludes(violations[0] ?? '', 'the catalog pins effect@^4.0.0-rc.112')
})

Deno.test('leaves a package without an exact effect peer floated', () => {
  const violations = catalogCouplingViolations(
    { 'effect': '4.0.0-rc.112', '@systemfsoftware/tsconfig': '^1' },
    [{ name: '@systemfsoftware/tsconfig', version: '1.3.4' }],
  )

  assertEquals(violations, [])
})

Deno.test('pins every effect-locked catalog entry exactly at the workspace release', async () => {
  assertEquals(await catalogEffectCouplingViolations(REPO_ROOT), [])
})
