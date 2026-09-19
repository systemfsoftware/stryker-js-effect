import { assertEquals } from '@std/assert'
import { decidePhase, shouldOpenVersionPrAfterPublish } from './release-phase.ts'

Deno.test('unpublished versions publish before a version PR opens', () => {
  assertEquals(decidePhase(7, 0), 'publish')
  assertEquals(shouldOpenVersionPrAfterPublish('publish', 0), false)
})

Deno.test('pending intents with nothing owed open a version PR', () => {
  assertEquals(decidePhase(0, 3), 'version')
  assertEquals(shouldOpenVersionPrAfterPublish('version', 3), false)
})

Deno.test('idle when nothing is owed and nothing is pending', () => {
  assertEquals(decidePhase(0, 0), 'none')
  assertEquals(shouldOpenVersionPrAfterPublish('none', 0), false)
})

Deno.test('publish with leftover intents still owes a version PR', () => {
  assertEquals(decidePhase(7, 3), 'publish')
  assertEquals(shouldOpenVersionPrAfterPublish('publish', 3), true)
})
