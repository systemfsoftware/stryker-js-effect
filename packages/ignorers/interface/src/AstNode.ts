import type {
  ArrowFunctionExpression as OxcArrowFunctionExpression,
  BinaryExpression as OxcBinaryExpression,
  CallExpression as OxcCallExpression,
  Function as OxcFunction,
  IdentifierReference as OxcIdentifier,
  IfStatement as OxcIfStatement,
  ImportDeclaration as OxcImportDeclaration,
  ImportNamespaceSpecifier as OxcImportNamespaceSpecifier,
  ImportSpecifier as OxcImportSpecifier,
  MemberExpression as OxcMemberExpression,
  MetaProperty as OxcMetaProperty,
  ObjectExpression as OxcObjectExpression,
  ObjectProperty as OxcProperty,
  Program as OxcProgram,
  StringLiteral as OxcStringLiteral,
} from '@oxc-project/types'

import {
  array,
  is,
  literal,
  nullable,
  optional,
  type Schema,
  string,
  struct,
  suspend,
  union,
  unknown,
} from './StandardSchema.js'

export type Identifier = OxcIdentifier
export type StringLiteral = OxcStringLiteral
export type Property = OxcProperty
export type FunctionExpression = OxcFunction
export type ObjectExpression = OxcObjectExpression
export type ArrowFunctionExpression = OxcArrowFunctionExpression
export type MemberExpression = OxcMemberExpression
export type CallExpression = OxcCallExpression
export type MetaProperty = OxcMetaProperty
export type BinaryExpression = OxcBinaryExpression
export type IfStatement = OxcIfStatement
export type ImportSpecifier = OxcImportSpecifier
export type ImportNamespaceSpecifier = OxcImportNamespaceSpecifier
export type ImportDeclaration = OxcImportDeclaration
export type Program = OxcProgram

export interface UnknownNode {
  readonly type: string
}

export type AstNodeType =
  | Identifier
  | StringLiteral
  | ObjectExpression
  | Property
  | ArrowFunctionExpression
  | FunctionExpression
  | MemberExpression
  | CallExpression
  | MetaProperty
  | BinaryExpression
  | IfStatement
  | ImportSpecifier
  | ImportNamespaceSpecifier
  | ImportDeclaration
  | Program
  | UnknownNode

export const AstNode: Schema<AstNodeType> = suspend(
  (): Schema<AstNodeType> =>
    union([
      Identifier,
      StringLiteral,
      ObjectExpression,
      Property,
      ArrowFunctionExpression,
      FunctionExpression,
      MemberExpression,
      CallExpression,
      MetaProperty,
      BinaryExpression,
      IfStatement,
      ImportSpecifier,
      ImportNamespaceSpecifier,
      ImportDeclaration,
      Program,
      UnknownNode,
    ]),
  { maxDepth: 6 },
)

export const Identifier = struct({
  type: literal('Identifier'),
  name: string(),
})

export const StringLiteral = struct({
  type: literal('Literal'),
  value: string(),
})

export const ObjectExpression = struct({
  type: literal('ObjectExpression'),
})

export const Property = struct({
  type: literal('Property'),
})

export const ArrowFunctionExpression = struct({
  type: literal('ArrowFunctionExpression'),
})

export const FunctionExpression = struct({
  type: literal('FunctionExpression'),
})

export const MemberExpression = struct({
  type: literal('MemberExpression'),
  object: AstNode,
  property: AstNode,
})

export const CallExpression = struct({
  type: literal('CallExpression'),
  callee: AstNode,
  arguments: array(unknown()),
})

export const MetaProperty = struct({
  type: literal('MetaProperty'),
  meta: Identifier,
  property: Identifier,
})

export const BinaryExpression = struct({
  type: literal('BinaryExpression'),
  left: AstNode,
  right: AstNode,
})

export const IfStatement = struct({
  type: literal('IfStatement'),
  test: AstNode,
})

export const ImportSpecifier = struct({
  type: literal('ImportSpecifier'),
  imported: Identifier,
  local: Identifier,
})

export const ImportNamespaceSpecifier = struct({
  type: literal('ImportNamespaceSpecifier'),
  local: Identifier,
})

export const ImportDeclaration = struct({
  type: literal('ImportDeclaration'),
  source: StringLiteral,
  specifiers: array(union([ImportSpecifier, ImportNamespaceSpecifier])),
})

export const Program = struct({
  type: literal('Program'),
  body: array(unknown()),
})

export const UnknownNode: Schema<UnknownNode> = struct({
  type: string(),
})

export const isIdentifier = (value: unknown): value is Identifier => is(Identifier, value)
export const isStringLiteral = (value: unknown): value is StringLiteral => is(StringLiteral, value)
export const isObjectExpression = (value: unknown): value is ObjectExpression => is(ObjectExpression, value)
export const isProperty = (value: unknown): value is Property => is(Property, value)
export const isArrowFunctionExpression = (value: unknown): value is ArrowFunctionExpression =>
  is(ArrowFunctionExpression, value)
export const isFunctionExpression = (value: unknown): value is FunctionExpression => is(FunctionExpression, value)
export const isMemberExpression = (value: unknown): value is MemberExpression => is(MemberExpression, value)
export const isCallExpression = (value: unknown): value is CallExpression => is(CallExpression, value)
export const isMetaProperty = (value: unknown): value is MetaProperty => is(MetaProperty, value)
export const isBinaryExpression = (value: unknown): value is BinaryExpression => is(BinaryExpression, value)
export const isIfStatement = (value: unknown): value is IfStatement => is(IfStatement, value)
export const isImportSpecifier = (value: unknown): value is ImportSpecifier => is(ImportSpecifier, value)
export const isImportNamespaceSpecifier = (value: unknown): value is ImportNamespaceSpecifier =>
  is(ImportNamespaceSpecifier, value)
export const isImportDeclaration = (value: unknown): value is ImportDeclaration => is(ImportDeclaration, value)
export const isProgram = (value: unknown): value is Program => is(Program, value)
export const isUnknownNode = (value: unknown): value is UnknownNode => is(UnknownNode, value)

export interface NodePath {
  readonly node: unknown
  readonly parentPath?: NodePath | null | undefined
}

export const NodePathSchema: Schema<NodePath> = suspend(
  (): Schema<NodePath> =>
    struct({
      node: AstNode,
      parentPath: optional(nullable(NodePathSchema)),
    }),
  { maxDepth: 6 },
)

export function* ancestorsOf(path: NodePath): Generator<unknown> {
  for (let current = path.parentPath; current; current = current.parentPath) {
    yield current.node
  }
}
