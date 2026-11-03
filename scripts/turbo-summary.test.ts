import { assertEqual } from './assert.ts'
import { readSummaries } from './turbo-summary.ts'

const cached = {
  taskId: 'a#build',
  command: 'tsdown',
  hash: 'h1',
  cache: { status: 'HIT' },
  execution: { exitCode: 0 },
}
const failing = {
  taskId: 'b#test',
  command: 'vitest',
  hash: 'h2',
  cache: { status: 'MISS' },
  execution: { exitCode: 1 },
}
const neverRan = { taskId: 'd#build', command: 'tsdown', hash: 'h4', cache: { status: 'MISS' }, execution: null }
const placeholder = { taskId: 'c#lint', command: '<NONEXISTENT>', hash: 'h3', cache: { status: 'MISS' } }
const wellFormed = { tasks: [cached, failing, neverRan, placeholder] }

Deno.test('a well-formed summary counts missed tasks and names failed ones, skipping placeholders', () => {
  assertEqual(readSummaries([wellFormed]), { kind: 'read', missed: 2, failed: ['b#test'] })
})

Deno.test('a task that ran without an exit code is unreadable, never a pass', () => {
  const broken = { tasks: [cached, { ...failing, execution: {} }] }
  assertEqual(readSummaries([wellFormed, broken]), { kind: 'missing', field: '.tasks[].execution.exitCode' })
})

Deno.test('a task without a cache status is unreadable, never a miss', () => {
  const broken = { tasks: [{ ...cached, cache: {} }] }
  assertEqual(readSummaries([broken]), { kind: 'missing', field: '.tasks[].cache.status' })
})

Deno.test('no summary at all is unreadable', () => {
  assertEqual(readSummaries([]).kind, 'missing')
})
