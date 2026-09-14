import type { NodePath } from './AstNode.js'

export type {
  ArrowFunctionExpression,
  AstNodeType,
  BinaryExpression,
  CallExpression,
  FunctionExpression,
  Identifier,
  IfStatement,
  ImportDeclaration,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  MemberExpression,
  MetaProperty,
  NodePath,
  ObjectExpression,
  Program,
  Property,
  StringLiteral,
  UnknownNode,
} from './AstNode.js'

export interface PlainIgnorer {
  readonly name: string
  shouldIgnore(path: NodePath): string | undefined
}
