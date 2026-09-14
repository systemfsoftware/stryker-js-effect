interface Identifier {
  readonly type: 'Identifier'
  readonly name: string
}

interface StringLiteral {
  readonly type: 'Literal'
  readonly value: string
  readonly raw: string | null
}

interface MemberExpression {
  readonly type: 'MemberExpression'
  readonly object: Identifier
  readonly property: Identifier
  readonly optional: false
  readonly computed: false
}

interface BlockStatement {
  readonly type: 'BlockStatement'
  readonly body: []
}

interface ArrowFunctionExpression {
  readonly type: 'ArrowFunctionExpression'
  readonly expression: boolean
  readonly async: boolean
  readonly params: []
  readonly body: BlockStatement
  readonly id: null
  readonly generator: false
}

interface PropertyNode {
  readonly type: 'Property'
  readonly kind: 'init'
  readonly computed: boolean
  readonly method: false
  readonly shorthand: false
  readonly key: Identifier | StringLiteral
  readonly value: ExpressionNode
}

interface ObjectNode {
  readonly type: 'ObjectExpression'
  readonly properties: PropertyNode[]
}

interface CallExpression {
  readonly type: 'CallExpression'
  readonly callee: ExpressionNode
  readonly arguments: ExpressionNode[]
  readonly optional: false
}

type ExpressionNode =
  | Identifier
  | StringLiteral
  | MemberExpression
  | CallExpression
  | ObjectNode
  | ArrowFunctionExpression

export const identifier = (name: string): Identifier => ({ type: 'Identifier', name })

export const memberOf = (object: string, property: string): MemberExpression => ({
  type: 'MemberExpression',
  object: identifier(object),
  property: identifier(property),
  optional: false,
  computed: false,
})

export const callOf = (callee: ExpressionNode, args: readonly ExpressionNode[]): CallExpression => ({
  type: 'CallExpression',
  callee,
  arguments: [...args],
  optional: false,
})

export const symbolForCall = (description: ExpressionNode): CallExpression =>
  callOf(memberOf('Symbol', 'for'), [description])

export const taggedCall = (factory: string, tag: ExpressionNode, fields: ExpressionNode): CallExpression =>
  callOf(callOf(memberOf('Schema', factory), []), [tag, fields])

export const bareFactoryCall = (factory: string, tag: ExpressionNode, fields: ExpressionNode): CallExpression =>
  callOf(callOf(identifier(factory), []), [tag, fields])

export const classCall = (id: ExpressionNode, fields: ExpressionNode): CallExpression =>
  callOf(callOf(memberOf('Schema', 'Class'), [id]), [fields])

export const brandCall = (name: ExpressionNode): CallExpression => callOf(memberOf('S', 'brand'), [name])

export const propertyOf = (key: Identifier | StringLiteral, value: ExpressionNode, computed = false): PropertyNode => ({
  type: 'Property',
  kind: 'init',
  computed,
  method: false,
  shorthand: false,
  key,
  value,
})

export const namedProperty = (key: string, value: ExpressionNode): PropertyNode => propertyOf(identifier(key), value)

export const objectOf = (properties: readonly PropertyNode[]): ObjectNode => ({
  type: 'ObjectExpression',
  properties: [...properties],
})

export const stringLiteral = (value: string): StringLiteral => ({ type: 'Literal', value, raw: null })

export const objectExpression = (properties: readonly PropertyNode[] = []): ObjectNode => ({
  type: 'ObjectExpression',
  properties: [...properties],
})

export const arrowFunction = (): ArrowFunctionExpression => ({
  type: 'ArrowFunctionExpression',
  expression: false,
  async: false,
  params: [],
  body: { type: 'BlockStatement', body: [] },
  id: null,
  generator: false,
})

export const annotationsCall = (argument: ExpressionNode): CallExpression =>
  callOf(memberOf('S', 'annotations'), [argument])
