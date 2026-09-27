import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'

import { classifyDocument, type Incompatibility, majorOf, streamVersionOf } from './contract-compat.ts'

const stream = (defs: Record<string, unknown>, order: readonly string[]) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: defs,
  anyOf: order.map((name) => ({ $ref: `#/$defs/${name}` })),
})

const event = (tag: string, props: Record<string, unknown>, required: readonly string[]) => ({
  type: 'object',
  properties: { _tag: { const: tag }, ...props },
  required: ['_tag', ...required],
})

const runStart = (props: Record<string, unknown>, required: readonly string[] = ['schemaVersion']) =>
  event('runStart', { schemaVersion: { type: 'string', const: '1.1' }, ...props }, required)

const runEnd = () => event('runEnd', { schemaVersion: { type: 'string', const: '1.1' } }, ['schemaVersion'])

const only = (result: readonly Incompatibility[]): Incompatibility => {
  assertEquals(result.length, 1, `expected exactly one incompatibility, got ${JSON.stringify(result)}`)
  return result[0] as Incompatibility
}

const at = (result: readonly Incompatibility[], pointer: string): Incompatibility => {
  const found = result.find((entry) => entry.pointer === pointer)
  if (!found) throw new Error(`no incompatibility at ${pointer}: ${JSON.stringify(result)}`)
  return found
}

Deno.test('json schema: removing a property from an event is incompatible', () => {
  const before = stream({ RunStart: runStart({ pid: { type: 'integer' } }) }, ['RunStart'])
  const after = stream({ RunStart: runStart({}) }, ['RunStart'])
  const incompatibility = only(classifyDocument('json-schema', before, after))
  assertEquals(incompatibility.pointer, '/anyOf/0/properties/pid')
  assertEquals(incompatibility.reason, 'property removed: pid')
})

Deno.test('json schema: adding an optional property is compatible', () => {
  const before = stream({ RunStart: runStart({}) }, ['RunStart'])
  const after = stream({ RunStart: runStart({ host: { type: 'string' } }) }, ['RunStart'])
  assertEquals(classifyDocument('json-schema', before, after), [])
})

Deno.test('json schema: adding an event kind is compatible', () => {
  const before = stream({ RunStart: runStart({}) }, ['RunStart'])
  const after = stream({ RunStart: runStart({}), RunEnd: runEnd() }, ['RunStart', 'RunEnd'])
  assertEquals(classifyDocument('json-schema', before, after), [])
})

Deno.test('json schema: removing an event kind names the removed _tag branch', () => {
  const before = stream({ RunStart: runStart({}), RunEnd: runEnd() }, ['RunStart', 'RunEnd'])
  const after = stream({ RunStart: runStart({}) }, ['RunStart'])
  const incompatibility = only(classifyDocument('json-schema', before, after))
  assertEquals(incompatibility.pointer, '/anyOf/1')
  assertEquals(incompatibility.reason, 'event branch removed: _tag "runEnd"')
})

Deno.test('json schema: making an optional property required is incompatible', () => {
  const before = stream({ RunStart: runStart({ pid: { type: 'integer' } }) }, ['RunStart'])
  const after = stream({ RunStart: runStart({ pid: { type: 'integer' } }, ['schemaVersion', 'pid']) }, ['RunStart'])
  const incompatibility = only(classifyDocument('json-schema', before, after))
  assertEquals(incompatibility.pointer, '/anyOf/0/required')
  assertEquals(incompatibility.reason, 'property made required: pid')
})

Deno.test('json schema: a newly required property is incompatible', () => {
  const before = stream({ RunStart: runStart({}) }, ['RunStart'])
  const after = stream({ RunStart: runStart({ host: { type: 'string' } }, ['schemaVersion', 'host']) }, ['RunStart'])
  const incompatibility = only(classifyDocument('json-schema', before, after))
  assertEquals(incompatibility.pointer, '/anyOf/0/required')
  assertEquals(incompatibility.reason, 'property made required: host')
})

Deno.test('json schema: removing an enum value is incompatible and adding one is compatible', () => {
  const before = stream({ RunStart: runStart({ level: { enum: ['a', 'b'] } }) }, ['RunStart'])
  const after = stream({ RunStart: runStart({ level: { enum: ['a'] } }) }, ['RunStart'])
  const removed = only(classifyDocument('json-schema', before, after))
  assertEquals(removed.pointer, '/anyOf/0/properties/level')
  assertStringIncludes(removed.reason, '"b"')

  assertEquals(classifyDocument('json-schema', after, before), [])
})

Deno.test('json schema: changing a const value is incompatible', () => {
  const before = stream({ RunStart: runStart({}) }, ['RunStart'])
  const after = stream(
    { RunStart: event('runStart', { schemaVersion: { type: 'string', const: '2.0' } }, ['schemaVersion']) },
    ['RunStart'],
  )
  const incompatibility = only(classifyDocument('json-schema', before, after))
  assertEquals(incompatibility.pointer, '/anyOf/0/properties/schemaVersion')
  assertStringIncludes(incompatibility.reason, '"1.1"')
})

Deno.test('json schema: narrowing a type set is incompatible and widening it is compatible', () => {
  const broad = stream({ RunStart: runStart({ pid: { type: ['integer', 'string'] } }) }, ['RunStart'])
  const narrow = stream({ RunStart: runStart({ pid: { type: 'integer' } }) }, ['RunStart'])
  const incompatibility = only(classifyDocument('json-schema', broad, narrow))
  assertEquals(incompatibility.pointer, '/anyOf/0/properties/pid/type')
  assertStringIncludes(incompatibility.reason, 'string')

  assertEquals(classifyDocument('json-schema', narrow, broad), [])
})

Deno.test('json schema: a change inside a referenced $defs entry is found through the $ref', () => {
  const detailBefore = {
    type: 'object',
    properties: { kind: { type: 'string' }, label: { type: 'string' } },
    required: ['kind'],
  }
  const detailAfter = { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'] }
  const before = stream({ RunStart: runStart({ detail: { $ref: '#/$defs/Detail' } }), Detail: detailBefore }, [
    'RunStart',
  ])
  const after = stream({ RunStart: runStart({ detail: { $ref: '#/$defs/Detail' } }), Detail: detailAfter }, [
    'RunStart',
  ])
  const incompatibility = only(classifyDocument('json-schema', before, after))
  assertEquals(incompatibility.pointer, '/anyOf/0/properties/detail/properties/label')
  assertEquals(incompatibility.reason, 'property removed: label')
})

Deno.test('json schema: removing an untagged union branch is incompatible', () => {
  const before = stream({ RunStart: runStart({ value: { anyOf: [{ type: 'string' }, { type: 'integer' }] } }) }, [
    'RunStart',
  ])
  const after = stream({ RunStart: runStart({ value: { anyOf: [{ type: 'string' }] } }) }, ['RunStart'])
  const incompatibility = only(classifyDocument('json-schema', before, after))
  assertEquals(incompatibility.pointer, '/anyOf/0/properties/value/anyOf/1')
  assertEquals(incompatibility.reason, 'union branch removed at index 1')
})

Deno.test('json schema: collapsing a multi-branch union to one schema is incompatible', () => {
  const before = stream({ RunStart: runStart({ value: { anyOf: [{ type: 'string' }, { type: 'integer' }] } }) }, [
    'RunStart',
  ])
  const after = stream({ RunStart: runStart({ value: { type: 'string' } }) }, ['RunStart'])
  const incompatibility = only(classifyDocument('json-schema', before, after))
  assertEquals(incompatibility.pointer, '/anyOf/0/properties/value')
  assertEquals(incompatibility.reason, 'union replaced by a single schema')
})

Deno.test('json schema: adding an optional property inside a nested schema is compatible', () => {
  const detail = (extra: Record<string, unknown>) => ({
    type: 'object',
    properties: { kind: { type: 'string' }, ...extra },
    required: ['kind'],
  })
  const before = stream({ RunStart: runStart({ detail: detail({}) }) }, ['RunStart'])
  const after = stream({ RunStart: runStart({ detail: detail({ note: { type: 'string' } }) }) }, ['RunStart'])
  assertEquals(classifyDocument('json-schema', before, after), [])
})

const catalogEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'arithmetic',
  name: 'ArithmeticOperator',
  tier: 'default',
  definition: { kind: 'binary' },
  examples: [{ before: '2 + 2', after: ['2 - 2'] }],
  ...overrides,
})

Deno.test('catalog: removing an entry is incompatible and adding one is compatible', () => {
  const incompatibility = only(classifyDocument('catalog', [catalogEntry()], []))
  assertEquals(incompatibility.pointer, '/0')
  assertEquals(incompatibility.reason, 'catalog entry removed: id "arithmetic"')

  assertEquals(classifyDocument('catalog', [], [catalogEntry()]), [])
})

Deno.test('catalog: renaming an entry by id is incompatible', () => {
  const incompatibility = only(classifyDocument('catalog', [catalogEntry()], [catalogEntry({ id: 'arith' })]))
  assertEquals(incompatibility.reason, 'catalog entry renamed: id "arithmetic" -> "arith"')
})

Deno.test('catalog: changing an entry tier or name is incompatible', () => {
  const tier = only(classifyDocument('catalog', [catalogEntry()], [catalogEntry({ tier: 'optIn' })]))
  assertEquals(tier.pointer, '/0/tier')
  assertStringIncludes(tier.reason, 'default -> optIn')

  const name = only(classifyDocument('catalog', [catalogEntry()], [catalogEntry({ name: 'Arithmetic' })]))
  assertEquals(name.pointer, '/0/name')
  assertStringIncludes(name.reason, '"ArithmeticOperator" -> "Arithmetic"')
})

Deno.test('catalog: changing an entry definition is compatible', () => {
  const changed = catalogEntry({ definition: { kind: 'unary' }, examples: [] })
  assertEquals(classifyDocument('catalog', [catalogEntry()], [changed]), [])
})

const span = (overrides: Record<string, unknown> = {}) => ({
  id: 'stryker.cli.run',
  name: 'stryker.cli.run',
  attributes: { 'stryker.mutant': { type: 'string' } },
  ...overrides,
})

Deno.test('taxonomy: removing a span is incompatible and adding one is compatible', () => {
  const incompatibility = only(classifyDocument('taxonomy', [span()], []))
  assertEquals(incompatibility.reason, 'span removed: id "stryker.cli.run"')

  assertEquals(classifyDocument('taxonomy', [], [span()]), [])
})

Deno.test('taxonomy: renaming a span by id is incompatible', () => {
  const incompatibility = only(classifyDocument('taxonomy', [span()], [span({ id: 'stryker.cli.exec' })]))
  assertEquals(incompatibility.reason, 'span renamed: id "stryker.cli.run" -> "stryker.cli.exec"')
})

Deno.test('taxonomy: removing a span attribute is incompatible and adding one is compatible', () => {
  const before = [span({ attributes: { 'stryker.mutant': { type: 'string' }, 'stryker.file': { type: 'string' } } })]
  const after = [span({ attributes: { 'stryker.mutant': { type: 'string' } } })]
  const incompatibility = only(classifyDocument('taxonomy', before, after))
  assertEquals(incompatibility.pointer, '/0/attributes/stryker.file')
  assertEquals(incompatibility.reason, 'span attribute removed: stryker.file')

  assertEquals(classifyDocument('taxonomy', after, before), [])
})

Deno.test('taxonomy: narrowing a span attribute schema through recursion is incompatible', () => {
  const before = [span({ attributes: { 'stryker.mutant': { type: ['string', 'integer'] } } })]
  const after = [span({ attributes: { 'stryker.mutant': { type: 'string' } } })]
  const incompatibility = only(classifyDocument('taxonomy', before, after))
  assertEquals(incompatibility.pointer, '/0/attributes/stryker.mutant/type')
  assertStringIncludes(incompatibility.reason, 'integer')
})

Deno.test('a document absent at the base is compatible and absent at the head is incompatible', () => {
  assertEquals(classifyDocument('json-schema', undefined, { anyOf: [] }), [])
  assertEquals(classifyDocument('json-schema', null, { anyOf: [] }), [])
  assertEquals(classifyDocument('taxonomy', [span()], undefined), [{ pointer: '', reason: 'document removed' }])
})

Deno.test('a document whose shape flips between array and object is incompatible', () => {
  const incompatibility = only(classifyDocument('catalog', [], {}))
  assertEquals(incompatibility.reason, 'document shape changed between object and array')
})

Deno.test('streamVersionOf reads the schemaVersion const and refuses disagreement', () => {
  const document = (defs: Record<string, unknown>) => stream(defs, ['A'])
  assertEquals(streamVersionOf(document({ A: runStart({}) })), '1.1')
  assertEquals(streamVersionOf({ anyOf: [{ type: 'string' }] }), undefined)
  assertEquals(
    streamVersionOf(
      document({
        A: event('a', { schemaVersion: { const: '1.1' } }, []),
        B: event('b', { schemaVersion: { const: '1.1' } }, []),
      }),
    ),
    '1.1',
  )
  assertThrows(
    () =>
      streamVersionOf({
        anyOf: [
          { properties: { schemaVersion: { const: '1.1' } } },
          { properties: { schemaVersion: { const: '2.0' } } },
        ],
      }),
    Error,
    'disagreeing',
  )
})

Deno.test('majorOf parses the leading major segment', () => {
  assertEquals(majorOf('1.1'), 1)
  assertEquals(majorOf('0.3'), 0)
  assertEquals(majorOf('2'), 2)
  assertEquals(majorOf('x'), -1)
})

Deno.test('at() pinpoints a nested pointer among several incompatibilities', () => {
  const before = stream({ RunStart: runStart({ pid: { type: 'integer' }, level: { enum: ['a', 'b'] } }) }, [
    'RunStart',
  ])
  const after = stream({ RunStart: runStart({ level: { enum: ['a'] } }) }, ['RunStart'])
  const result = classifyDocument('json-schema', before, after)
  assertEquals(result.length, 2)
  assertStringIncludes(at(result, '/anyOf/0/properties/pid').reason, 'property removed')
  assertStringIncludes(at(result, '/anyOf/0/properties/level').reason, 'constraint narrowed')
})
