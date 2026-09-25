import type { Node } from '@systemfsoftware/stryker-ignorer-interface'
import { testIgnorer } from '@systemfsoftware/stryker-ignorer-kit/tester'
import { describe, it } from '@systemfsoftware/vitest'

import {
  INPUT_MODEL_OUTPUT_CONFIG_MSG,
  shouldIgnore,
  SIGNAL_QUERY_OPTIONS_MSG,
  strykerIgnorers,
} from '@systemfsoftware/stryker-ignorer-angular'

const descriptor = strykerIgnorers[0]
if (descriptor === undefined) {
  throw new Error('the package publishes one ignorer descriptor')
}

const INLINE_CLASS = 'class C {\n  foo = input.required({ required: true })\n}\n'
const VALUE_CLASS = 'class C {\n  foo = input(0, { value: 1 })\n}\n'
const MODEL_CLASS = 'class C {\n  foo = model(0, { value: 1 })\n}\n'
const OUTPUT_CLASS = 'class C {\n  foo = output({ alias: "bar" })\n}\n'
const QUERY_CLASS = 'class C {\n  bar = viewChild(BarToken, { read: BarToken })\n}\n'
const QUERY_REQUIRED_CLASS = 'class C {\n  bar = viewChild.required(BarToken, { read: BarToken })\n}\n'
const CONTENT_CHILD_CLASS = 'class C {\n  bar = contentChild(Token, { read: Token })\n}\n'
const CONTENT_CHILDREN_CLASS = 'class C {\n  bar = contentChildren(Token, { read: Token })\n}\n'
const VIEW_CHILDREN_CLASS = 'class C {\n  bar = viewChildren(Token, { read: Token })\n}\n'
const NESTED_CLASS = 'class C {\n  foo = input.required({ outer: { inner: 1 } })\n}\n'

const identifier = (name: string): Node => ({ type: 'Identifier', name }) as unknown as Node
const object = (): Node => ({ type: 'ObjectExpression' }) as unknown as Node
const member = (objectNode: Node, property: Node, computed = false): Node =>
  ({ type: 'MemberExpression', object: objectNode, property, computed }) as unknown as Node
const call = (callee: Node, args: readonly Node[]): Node =>
  ({ type: 'CallExpression', callee, arguments: args }) as unknown as Node
const arrayOf = (elements: readonly Node[]): Node => ({ type: 'ArrayExpression', elements }) as unknown as Node

describe('angular-signals', () => {
  it('Should_Register_The_Descriptor', function*({ expect }) {
    yield* expect(descriptor.name).toBe('angular-signals')
  })

  it('Should_Ignore_Nothing_Without_An_Ancestor_Call', function*({ expect }) {
    yield* expect([
      shouldIgnore(object(), []),
      shouldIgnore(object(), [arrayOf([])]),
      shouldIgnore(object(), [call(identifier('compute'), [object()])]),
    ]).toEqual([undefined, undefined, undefined])
  })

  it('Should_Ignore_Nothing_When_The_Owner_Is_Absent', function*({ expect }) {
    yield* expect(shouldIgnore(object(), [call(identifier('input'), [object()])])).toBe(undefined)
  })

  it('Should_Ignore_Nothing_For_A_Non_Object_Node', function*({ expect }) {
    yield* expect(shouldIgnore(identifier('input'), [call(identifier('input'), [])])).toBe(undefined)
  })

  it('Should_Ignore_Nothing_For_A_Computed_Signal_Member', function*({ expect }) {
    const callee = member(identifier('input'), identifier('required'), true)
    yield* expect(shouldIgnore(object(), [call(callee, [object()])])).toBe(undefined)
  })

  it('Should_Ignore_Nothing_When_The_Callee_Object_Is_Not_A_Signal_Function', function*({ expect }) {
    const callee = member(member(identifier('obj'), identifier('input')), identifier('required'))
    yield* expect(shouldIgnore(object(), [call(callee, [object()])])).toBe(undefined)
  })

  it('Should_Ignore_Nothing_When_The_Member_Name_Is_Not_Required', function*({ expect }) {
    const callee = member(identifier('viewChild'), identifier('optional'))
    yield* expect(shouldIgnore(object(), [call(callee, [object()])])).toBe(undefined)
  })

  it('Should_Ignore_Nothing_When_The_Query_Options_Are_Not_The_Second_Argument', function*({ expect }) {
    yield* expect(shouldIgnore(object(), [call(identifier('viewChild'), [object()])])).toBe(undefined)
  })

  it('Should_Ignore_Nothing_When_The_Io_Options_Are_Not_At_The_Expected_Index', function*({ expect }) {
    yield* expect(
      shouldIgnore(object(), [call(member(identifier('input'), identifier('required')), [identifier('x')])]),
    ).toBe(undefined)
  })
})

await testIgnorer(descriptor, {
  ignored: [
    {
      name: 'an `input.required` configuration object',
      code: INLINE_CLASS,
      ignores: [{ text: '{ required: true }', reason: INPUT_MODEL_OUTPUT_CONFIG_MSG }],
    },
    {
      name: 'an `input` value configuration object',
      code: VALUE_CLASS,
      ignores: [{ text: '{ value: 1 }', reason: INPUT_MODEL_OUTPUT_CONFIG_MSG }],
    },
    {
      name: 'a `model` value configuration object',
      code: MODEL_CLASS,
      ignores: [{ text: '{ value: 1 }', reason: INPUT_MODEL_OUTPUT_CONFIG_MSG }],
    },
    {
      name: 'an `output` configuration object',
      code: OUTPUT_CLASS,
      ignores: [{ text: '{ alias: "bar" }', reason: INPUT_MODEL_OUTPUT_CONFIG_MSG }],
    },
    {
      name: 'a signal query option object',
      code: QUERY_CLASS,
      ignores: [{ text: '{ read: BarToken }', reason: SIGNAL_QUERY_OPTIONS_MSG }],
    },
    {
      name: 'a required signal query option object',
      code: QUERY_REQUIRED_CLASS,
      ignores: [{ text: '{ read: BarToken }', reason: SIGNAL_QUERY_OPTIONS_MSG }],
    },
    {
      name: 'a `contentChild` option object',
      code: CONTENT_CHILD_CLASS,
      ignores: [{ text: '{ read: Token }', reason: SIGNAL_QUERY_OPTIONS_MSG }],
    },
    {
      name: 'a `contentChildren` option object',
      code: CONTENT_CHILDREN_CLASS,
      ignores: [{ text: '{ read: Token }', reason: SIGNAL_QUERY_OPTIONS_MSG }],
    },
    {
      name: 'a `viewChildren` option object',
      code: VIEW_CHILDREN_CLASS,
      ignores: [{ text: '{ read: Token }', reason: SIGNAL_QUERY_OPTIONS_MSG }],
    },
    {
      name: 'an object nested inside an ignored signal configuration',
      code: NESTED_CLASS,
      ignores: [
        { text: '{ outer: { inner: 1 } }', reason: INPUT_MODEL_OUTPUT_CONFIG_MSG },
        { text: '{ inner: 1 }', reason: INPUT_MODEL_OUTPUT_CONFIG_MSG },
      ],
    },
  ],
  kept: [
    {
      name: 'a plain object literal in an unrelated call inside a class field',
      code: 'class C {\n  baz = compute({ keep: 1 })\n}\n',
      keeps: ['{ keep: 1 }'],
    },
    {
      name: 'an object literal outside any call',
      code: 'const plain = { keep: 1 }\n',
      keeps: ['{ keep: 1 }'],
    },
    {
      name: 'a plain object literal in a variable initializer call',
      code: 'const value = compute({ keep: 1 })\n',
      keeps: ['{ keep: 1 }'],
    },
    {
      name: 'an object nested inside an array argument',
      code: 'input.required([{ keep: 1 }])\n',
      keeps: ['{ keep: 1 }'],
    },
  ],
})
