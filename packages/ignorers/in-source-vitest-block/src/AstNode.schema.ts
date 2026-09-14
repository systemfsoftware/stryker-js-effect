import { Identifier, is, literal, type Schema, string, struct, union } from '@systemfsoftware/stryker-ignorer-interface'

export { Identifier }

export interface AstLike {
  readonly type: string
}

export interface MetaProperty {
  readonly type: 'MetaProperty'
  readonly meta: Identifier
  readonly property: Identifier
}

export interface ImportMetaMember {
  readonly type: 'MemberExpression'
  readonly object: MetaProperty
  readonly property: Identifier
}

export interface BinaryExpression {
  readonly type: 'BinaryExpression'
  readonly left: AstLike
  readonly right: AstLike
}

export interface IfStatement {
  readonly type: 'IfStatement'
  readonly test: AstLike
}

export const AstLike: Schema<AstLike> = struct({ type: string() })

export const MetaProperty: Schema<MetaProperty> = struct({
  type: literal('MetaProperty'),
  meta: Identifier,
  property: Identifier,
})

export const ImportMetaMember: Schema<ImportMetaMember> = struct({
  type: literal('MemberExpression'),
  object: MetaProperty,
  property: Identifier,
})

export const BinaryExpression: Schema<BinaryExpression> = struct({
  type: literal('BinaryExpression'),
  left: AstLike,
  right: AstLike,
})

export const IfStatement: Schema<IfStatement> = struct({
  type: literal('IfStatement'),
  test: AstLike,
})

export type AstNodeType = Identifier | MetaProperty | ImportMetaMember | BinaryExpression | IfStatement | AstLike

export const AstNode: Schema<AstNodeType> = union([
  Identifier,
  MetaProperty,
  ImportMetaMember,
  BinaryExpression,
  IfStatement,
  AstLike,
])

export const isImportMetaMember = (value: unknown): value is ImportMetaMember => is(ImportMetaMember, value)
export const isBinaryExpression = (value: unknown): value is BinaryExpression => is(BinaryExpression, value)
export const isIfStatement = (value: unknown): value is IfStatement => is(IfStatement, value)
