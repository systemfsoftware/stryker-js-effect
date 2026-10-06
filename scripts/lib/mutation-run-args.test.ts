import { assertEquals } from '@std/assert'

import { publishedCliRunArgsOf } from './mutation-run-args.ts'

Deno.test('a shard run asks the published CLI for full mode with --force and names its shard incremental file', () => {
  assertEquals(publishedCliRunArgsOf({ index: 1, count: 2 }), [
    '--incrementalFile',
    'reports/stryker-incremental-1of2.json',
    '--force',
  ])
})

Deno.test('an unsharded run asks the published CLI for full mode with --force on the default incremental file', () => {
  assertEquals(publishedCliRunArgsOf(undefined), [
    '--incrementalFile',
    'reports/stryker-incremental.json',
    '--force',
  ])
})
