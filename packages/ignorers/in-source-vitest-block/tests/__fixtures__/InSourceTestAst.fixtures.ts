interface Identifier {
  readonly type: 'Identifier'
  readonly name: string
}

interface MetaProperty {
  readonly type: 'MetaProperty'
  readonly meta: Identifier
  readonly property: Identifier
}

interface MemberExpression {
  readonly type: 'MemberExpression'
  readonly object: MetaProperty
  readonly property: Identifier
  readonly optional: false
  readonly computed: false
}

interface BinaryExpression {
  readonly type: 'BinaryExpression'
  readonly left: ExpressionNode
  readonly right: ExpressionNode
  readonly operator: '==='
}

interface BlockStatement {
  readonly type: 'BlockStatement'
  readonly body: []
}

interface IfStatement {
  readonly type: 'IfStatement'
  readonly test: ExpressionNode
  readonly consequent: BlockStatement
  readonly alternate: null
}

type ExpressionNode = Identifier | MetaProperty | MemberExpression | BinaryExpression

export const identifier = (name: string): Identifier => ({ type: 'Identifier', name })

export const metaOf = (meta: string, property: string): MetaProperty => ({
  type: 'MetaProperty',
  meta: identifier(meta),
  property: identifier(property),
})

export const importMetaMember = (property: string): MemberExpression => ({
  type: 'MemberExpression',
  object: metaOf('import', 'meta'),
  property: identifier(property),
  optional: false,
  computed: false,
})

export const binaryOf = (left: ExpressionNode, right: ExpressionNode): BinaryExpression => ({
  type: 'BinaryExpression',
  left,
  right,
  operator: '===',
})

export const guardOf = (test: ExpressionNode): IfStatement => ({
  type: 'IfStatement',
  test,
  consequent: { type: 'BlockStatement', body: [] },
  alternate: null,
})
